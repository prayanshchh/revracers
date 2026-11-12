#include <algorithm>
#include <cmath>
#include <cstring>
#include <random>
#include <vector>
#include <emscripten/emscripten.h>

#include <tgf.h>
#include <robottools.h>

#include "sim.h"
#include "ai.h"
#include "game.h"
#include "session.h"
#include "stewards.h"

namespace
{

enum Kind
{
    KIND_SOLO,
    KIND_RACE,
    KIND_QUALIFYING,
    KIND_LAPPING
};

enum Phase
{
    PHASE_RUNNING,
    PHASE_FLAG,
    PHASE_COMPLETE,
    PHASE_WEEKEND_DONE
};

enum CarStatus
{
    STATUS_TRACK,
    STATUS_OUT_LAP,
    STATUS_PUSH_LAP,
    STATUS_IN_LAP,
    STATUS_PIT_LANE,
    STATUS_GARAGE,
    STATUS_FINISHED,
    STATUS_RETIRED,
    STATUS_KNOCKED_OUT,
    STATUS_QUEUED,
    STATUS_DISQUALIFIED
};

enum RunState
{
    RUN_WAITING,
    RUN_OUT,
    RUN_FLYING,
    RUN_DONE
};

const int timingPoints = 128;
const int timingLaps = 3;
const int segments = 3;
const int segmentKnockouts[segments] = {6, 6, 0};
const double raceFuelPerLap = 1.6;
const double raceFuelLapLength = 5478.0;
const double qualifyingFuel = 7.0;
const double runTimeout = 420.0;
const double contactWindow = 0.8;
const double detectionShare = 0.94;
const double overtakeWindow = 1.0;
const double stopQuantiles[] = {2.0, 2.2, 2.3, 2.4, 2.5, 2.5, 2.6, 2.7, 2.7, 2.8, 2.9,
                                3.0, 3.1, 3.2, 3.3, 3.5, 3.8, 4.2, 5.1, 6.4, 10.0};
const int stopQuantileCount = sizeof(stopQuantiles) / sizeof(stopQuantiles[0]);
const double fieldStopMedian = 2.9;
const double crewStopMedians[] = {2.6, 2.9, 2.6, 2.7, 2.9, 2.9, 2.95, 3.4, 2.8, 2.6, 3.95};
const int crewCount = sizeof(crewStopMedians) / sizeof(crewStopMedians[0]);
const int firstTeamBay = 1;
const double fastestCrewStop = 1.8;
const double longestCrewStop = 10.0;
const double blueFlagGap = 1.1;
const double lapNoiseSize = 0.0012;
const double raceFormSwing = 0.006;
const double reactionLow = 0.16;
const double reactionHigh = 0.38;
const double trackGripStart = 0.982;
const double raceTrackGrip = 1.0;
const double softCompound = 0;
const double wornPitLimit = 0.9;
const double wornFlagLimit = 0.98;
const int shortRaceLaps = 20;
const int defaultRaceCompound = 1;
const double missedCompoundPenalty = 30.0;
const double damagePitLimit = 0.35;
const double flatPitLimit = 0.6;
const double defaultReference = 97.5;
const double lapPerSpeed = 0.33;
const double lapPerPower = 0.25;
const double simulatedNoise = 0.0018;
const double retireStuckSeconds = 45.0;
const double weatherPatienceLow = 4.0;
const double weatherPatienceHigh = 40.0;
const double weatherLookLow = 30.0;
const double weatherLookHigh = 150.0;
const int hardFromLaps = 28;
const int mediumFromLaps = 11;
const int maxSectors = 4;
const double sectorJump = 150.0;
const int sectorFields = 3 * maxSectors;

struct Stint
{
    int compound;
    double from;
};

struct CarPlan
{
    std::vector<Stint> stints;
    double speed = 1.0;
    double raceSpeed = 1.0;
    double power = 1.0;
};

struct Timing
{
    int position = 1;
    int status = STATUS_TRACK;
    int laps = 0;
    int lastLaps = 0;
    int chequeredLaps = 0;
    double bestLap = 0;
    double lastLap = 0;
    double segmentBest = 0;
    double segmentBestAt = 0;
    double segmentTimes[segments] = {0, 0, 0};
    int knockedRank = 0;
    int pits = 0;
    bool finished = false;
    bool retired = false;
    double finishTime = 0;
    int finishOrder = 0;
    int finishLaps = 0;
    bool eliminated = false;
    int lastPoint = -1;
    std::vector<double> points;
    double gapLeader = 0;
    double gapAhead = 0;
    int lapsDown = 0;
    double lastContact = -100;
    double lastWall = -100;
    double lastDetect = 0;
    size_t stintIndex = 0;
    int stintStartLap = 0;
    double stintStartWear = 0;
    double pitJitter = 0;
    int run = RUN_WAITING;
    double runStart = 0;
    double progress = 0;
    int contacts = 0;
    double penalties = 0;
    bool disqualified = false;
    double weatherDue = 0;
    double weatherPatience = 0;
    double weatherLook = 0;
    bool weatherStop = false;
    bool pinned = false;
    double pinX = 0;
    double pinY = 0;
    double pinYaw = 0;
    int sectorLap = -1;
    bool fromLine = false;
    bool lastLapFull = false;
    int nextBoundary = 0;
    double lastDistance = 0;
    double lastClock = 0;
    int tracePoint = -1;
    double splits[maxSectors] = {0, 0, 0, 0};
    double sectorNow[maxSectors] = {0, 0, 0, 0};
    double sectorLast[maxSectors] = {0, 0, 0, 0};
    double sectorBest[maxSectors] = {0, 0, 0, 0};
    double trace[timingPoints + 1] = {};
};

struct PassEvent
{
    double time;
    int passer;
    int passed;
    int position;
    int lap;
};

struct Stats
{
    int contactEvents = 0;
    int playerContacts = 0;
    int wallHits = 0;
    int overtakes = 0;
    int pits = 0;
};

Kind kind = KIND_SOLO;
Phase phase = PHASE_RUNNING;
int totalLaps = 0;
int segment = 0;
double startDelay = 2.0;
double difficultyScale = 1.0;
double referenceLap = defaultReference;
unsigned seed = 1;
std::mt19937 rng(1);
std::mt19937 weatherRng(1);
std::vector<Timing> timing;
std::vector<CarPlan> plans;
std::vector<int> order;
std::vector<int> previousOrder;
Stats stats;
std::vector<PassEvent> passLog;
int finishers = 0;
int playerPitCompound = -1;
int onTrack = -1;
bool playerQueued = false;
std::vector<int> runOrder;
bool chequered = false;
double chequeredAt = 0;
int playerStartCompound = -1;
std::vector<int> startSlots;
std::vector<int> carBays;
bool playerChangedCompound = false;
double sessionSectors[maxSectors] = {0, 0, 0, 0};
int sessionSectorCars[maxSectors] = {-1, -1, -1, -1};
double fastestLap = 0;
int fastestCar = -1;
int fastestLapNumber = 0;
double fastestTrace[timingPoints + 1] = {};
double lineShape[timingPoints + 1] = {};
bool lineShapeReady = false;

double uniform(double low, double high)
{
    return std::uniform_real_distribution<double>(low, high)(rng);
}

double weatherUniform(double low, double high)
{
    return std::uniform_real_distribution<double>(low, high)(weatherRng);
}

double crewStop(int index, double luck)
{
    double at = std::clamp(luck, 0.0, 1.0) * (stopQuantileCount - 1);
    int low = std::min((int)at, stopQuantileCount - 2);
    double share = at - low;
    double field = stopQuantiles[low] + (stopQuantiles[low + 1] - stopQuantiles[low]) * share;
    int bay = index < (int)carBays.size() ? carBays[index] : -1;
    int garage = (bay - firstTeamBay) / 2;
    double median = bay >= firstTeamBay && garage < crewCount ? crewStopMedians[garage] : fieldStopMedian;
    return std::clamp(field * median / fieldStopMedian, fastestCrewStop, longestCrewStop);
}

double carProgress(tCarElt *car, double length)
{
    return (car->_laps - 1) + car->_distFromStartLine / length;
}

bool playerDriven(tCarElt *car)
{
    return car->index == 0 && !sdPlayerAutopilot();
}

int tyreFamily(int compound)
{
    return compound < 3 ? 0 : compound - 2;
}

int dryCompoundFor(int lapsLeft)
{
    if (lapsLeft > hardFromLaps)
        return 2;
    return lapsLeft > mediumFromLaps ? 1 : 0;
}

int pushCompound()
{
    return sdWeatherIdealCompound(sdWeatherFutureLine(0), (int)softCompound);
}

void recordTiming(tSituation *s, int i, double length)
{
    tCarElt *car = s->cars[i];
    Timing &t = timing[i];
    t.progress = carProgress(car, length);
    int total = (int)floor((t.progress + 1.0) * timingPoints);
    if (total < 0)
        total = 0;
    if (total <= t.lastPoint)
        return;
    int capacity = timingPoints * timingLaps;
    for (int p = std::max(t.lastPoint + 1, total - capacity + 1); p <= total; p++)
        t.points[p % capacity] = s->currentTime;
    t.lastPoint = total;
}

void updateOrder(tSituation *s)
{
    std::stable_sort(order.begin(), order.end(), [](int a, int b) {
        const Timing &x = timing[a];
        const Timing &y = timing[b];
        if (kind == KIND_QUALIFYING)
        {
            if (x.eliminated != y.eliminated)
                return !x.eliminated;
            if (x.eliminated)
                return x.knockedRank < y.knockedRank;
            double tx = x.segmentBest > 0 ? x.segmentBest : 1e9;
            double ty = y.segmentBest > 0 ? y.segmentBest : 1e9;
            if (tx != ty)
                return tx < ty;
            return x.segmentBestAt < y.segmentBestAt;
        }
        if (x.disqualified != y.disqualified)
            return y.disqualified;
        if (x.retired != y.retired)
            return y.retired;
        if (x.finished != y.finished)
            return x.finished;
        if (x.finished)
        {
            if (x.finishLaps != y.finishLaps)
                return x.finishLaps > y.finishLaps;
            return x.finishTime + x.penalties + sdStewardsTimeAdded(a) < y.finishTime + y.penalties + sdStewardsTimeAdded(b);
        }
        return x.progress > y.progress;
    });
    for (int rank = 0; rank < (int)order.size(); rank++)
    {
        int i = order[rank];
        timing[i].position = rank + 1;
        s->cars[i]->_pos = rank + 1;
    }
}

void updateGaps(tSituation *s)
{
    if (order.empty() || kind != KIND_RACE)
        return;
    int leader = order[0];
    int capacity = timingPoints * timingLaps;
    for (int rank = 0; rank < (int)order.size(); rank++)
    {
        int i = order[rank];
        Timing &t = timing[i];
        if (t.lastPoint < 0 || t.finished)
            continue;
        const auto gapTo = [&](int other) {
            const Timing &o = timing[other];
            if (o.lastPoint - t.lastPoint >= capacity - timingPoints)
                return -1.0;
            return std::max(0.0, t.points[t.lastPoint % capacity] - o.points[t.lastPoint % capacity]);
        };
        t.lapsDown = rank == 0 ? 0 : std::max(0, (timing[leader].lastPoint - t.lastPoint) / timingPoints);
        t.gapLeader = rank == 0 ? 0 : gapTo(leader);
        t.gapAhead = rank == 0 ? 0 : gapTo(order[rank - 1]);
    }
}

void countOvertakes(tSituation *s)
{
    if (previousOrder.size() != order.size())
    {
        previousOrder = order;
        return;
    }
    std::vector<int> before(order.size());
    for (int rank = 0; rank < (int)order.size(); rank++)
        before[previousOrder[rank]] = rank;
    for (int rank = 0; rank + 1 < (int)order.size(); rank++)
    {
        int up = order[rank];
        int down = order[rank + 1];
        if (before[up] > before[down] && !sdAiInPitLane(down) && !sdAiInPitLane(up) && (s->cars[down]->_state & RM_CAR_STATE_NO_SIMU) == 0)
        {
            stats.overtakes++;
            passLog.push_back({s->currentTime, up, down, rank + 1, std::max(1, s->cars[up]->_laps)});
        }
    }
    previousOrder = order;
}

void armOvertakes(tSituation *s, double length)
{
    double detection = length * detectionShare;
    for (int rank = 1; rank < (int)order.size(); rank++)
    {
        int i = order[rank];
        tCarElt *car = s->cars[i];
        Timing &t = timing[i];
        bool crossed = t.lastDetect < detection && car->_distFromStartLine >= detection;
        t.lastDetect = car->_distFromStartLine;
        if (crossed && car->_laps >= 2 && t.gapAhead > 0 && t.gapAhead <= overtakeWindow)
            sdEnergyArmOvertake(i);
    }
}

void closeLapsRace(tSituation *s)
{
    for (int i = 0; i < s->_ncars; i++)
    {
        tCarElt *car = s->cars[i];
        Timing &t = timing[i];
        if (car->_laps == t.lastLaps)
            continue;
        t.lastLaps = car->_laps;
        t.laps = car->_laps;
        t.lastLap = car->_lastLapTime;
        sdAiSetLapNoise(i, 1.0 + uniform(-raceFormSwing, raceFormSwing));
        if (car->_laps > 1 && car->_lastLapTime > 0 && t.lastLapFull && !sdStewardsLastLapInvalid(i) && (t.bestLap == 0 || car->_lastLapTime < t.bestLap))
            t.bestLap = car->_lastLapTime;
    }
}

void retireStuckCars(tSituation *s)
{
    for (int i = 0; i < s->_ncars; i++)
    {
        tCarElt *car = s->cars[i];
        Timing &t = timing[i];
        if (t.finished || t.retired || sdAiInPitLane(i))
            continue;
        bool dry = car->_fuel <= 0 && fabs(car->_speed_x) < 1.0;
        if (playerDriven(car) && !dry)
            continue;
        if (sdAiStuckTime(i) < retireStuckSeconds && !dry && (car->_state & RM_CAR_STATE_NO_SIMU) == 0)
            continue;
        t.retired = true;
        t.status = STATUS_RETIRED;
        car->_state |= RM_CAR_STATE_ELIMINATED;
    }
}

void raceFinish(tSituation *s)
{
    int retired = 0;
    for (const Timing &t : timing)
        if (t.retired)
            retired++;
    if (finishers + retired >= s->_ncars)
        phase = PHASE_COMPLETE;
    for (int i = 0; i < s->_ncars; i++)
    {
        tCarElt *car = s->cars[i];
        Timing &t = timing[i];
        if (t.finished || t.retired)
            continue;
        bool crossedFlag = chequered && car->_laps > t.chequeredLaps;
        if (car->_laps > totalLaps || crossedFlag)
        {
            t.finished = true;
            t.finishTime = s->currentTime;
            t.finishOrder = ++finishers;
            t.finishLaps = car->_laps;
            t.status = STATUS_FINISHED;
            if (playerDriven(car) && totalLaps >= shortRaceLaps && !playerChangedCompound)
                t.penalties += missedCompoundPenalty;
            if (!chequered)
            {
                chequered = true;
                chequeredAt = s->currentTime;
                for (int k = 0; k < s->_ncars; k++)
                    timing[k].chequeredLaps = s->cars[k]->_laps;
            }
            if (!playerDriven(car))
                sdAiSetTask(i, AI_COOL_DOWN);
        }
    }
}

bool weatherCall(tSituation *s, int i)
{
    tCarElt *car = s->cars[i];
    Timing &t = timing[i];
    int lapsLeft = totalLaps - car->_laps + 1;
    if (lapsLeft <= 1)
        return false;
    double soon = sdWeatherFutureLine(t.weatherLook);
    double now = sdWeatherFutureLine(0);
    int fitted = sdTyresCompound(i);
    int wanted = sdWeatherIdealCompound(std::max(now, soon), dryCompoundFor(lapsLeft));
    if (soon < now)
        wanted = sdWeatherIdealCompound(soon, dryCompoundFor(lapsLeft));
    if (tyreFamily(wanted) == tyreFamily(fitted))
    {
        t.weatherDue = 0;
        return false;
    }
    t.weatherDue += s->deltaTime;
    if (t.weatherDue < t.weatherPatience)
        return false;
    t.weatherDue = 0;
    t.weatherStop = true;
    t.stintIndex = plans[i].stints.empty() ? 0 : plans[i].stints.size() - 1;
    sdAiRequestPit(i, wanted, crewStop(i, weatherUniform(0, 1)) + sdStewardsOwedTime(i));
    t.pits++;
    t.stintStartLap = car->_laps + 1;
    t.stintStartWear = 0;
    stats.pits++;
    return true;
}

void raceStrategy(tSituation *s)
{
    int playerTyre = sdTyresCompound(0);
    if (playerTyre != playerStartCompound || sdWeatherWetCompound(playerTyre))
        playerChangedCompound = true;
    for (int i = 0; i < s->_ncars; i++)
    {
        tCarElt *car = s->cars[i];
        if (playerDriven(car))
            continue;
        Timing &t = timing[i];
        const CarPlan &plan = plans[i];
        if (t.finished || t.retired || sdAiInPitLane(i) || sdAiPitPending(i))
            continue;
        if (weatherCall(s, i))
            continue;
        bool hasNext = !t.weatherStop && t.stintIndex + 1 < plan.stints.size();
        bool dueNext = hasNext && (double)car->_laps >= std::max(2.0, plan.stints[t.stintIndex + 1].from * totalLaps + t.pitJitter);
        double wearNow = sdTyresWorstWear(i);
        double perLap = car->_laps > t.stintStartLap ? (wearNow - t.stintStartWear) / (car->_laps - t.stintStartLap) : 0.0;
        int lapsLeft = totalLaps - car->_laps + 1;
        bool lastsToFlag = wearNow + perLap * lapsLeft * 1.2 < wornFlagLimit;
        bool wornOut = wearNow + perLap * 1.1 > wornPitLimit && !lastsToFlag;
        bool emergency = lapsLeft > 1 && t.pits <= (int)plan.stints.size() + 1 && (wornOut || sdCarDamageShare(i) > damagePitLimit || sdTyresWorstLeak(i) > flatPitLimit);
        if (!dueNext && !emergency)
            continue;
        int compound = sdTyresCompound(i);
        if (hasNext)
        {
            t.stintIndex++;
            compound = plan.stints[t.stintIndex].compound;
        }
        else if (compound == 0)
            compound = 2;
        if (tyreFamily(compound) == 0)
            compound = sdWeatherIdealCompound(sdWeatherFutureLine(0), compound);
        sdAiRequestPit(i, compound, crewStop(i, uniform(0, 1)) + sdStewardsOwedTime(i));
        t.pits++;
        t.stintStartLap = car->_laps + 1;
        t.stintStartWear = 0;
        stats.pits++;
    }
}

void blueFlags(tSituation *s)
{
    for (int i = 0; i < s->_ncars; i++)
    {
        if (playerDriven(s->cars[i]))
            continue;
        bool wave = false;
        tCarElt *car = s->cars[i];
        double v = std::max(10.0, (double)car->_speed_x);
        for (int k = 0; k < s->_ncars && !wave; k++)
        {
            if (k == i)
                continue;
            double behind = sdAiWrap(car->_distFromStartLine - s->cars[k]->_distFromStartLine);
            if (behind > v * blueFlagGap)
                continue;
            wave = timing[k].progress - timing[i].progress > 0.5;
        }
        sdAiSetBlueFlag(i, wave || sdStewardsYield(i));
    }
}

bool humanPlayer(tSituation *s, int i)
{
    return playerDriven(s->cars[i]);
}

double expectedLap(int i)
{
    const CarPlan &plan = plans[i];
    double speedLoss = 1.0 - plan.speed * difficultyScale;
    double powerLoss = 1.0 - plan.power;
    return referenceLap * (1.0 + lapPerSpeed * speedLoss + lapPerPower * powerLoss);
}

void parkInGarage(tSituation *s, int i)
{
    double distance = 0, lateral = 0;
    sdAiBoxOf(sdAiBayOf(i), &distance, &lateral);
    sdCarTeleport(i, distance, lateral);
    sdAiResetAtBox(i);
    Timing &t = timing[i];
    const tDynPt &pose = SimCarTable[i].DynGCg;
    t.pinned = !humanPlayer(s, i);
    t.pinX = pose.pos.x;
    t.pinY = pose.pos.y;
    t.pinYaw = pose.pos.az;
    t.lastLaps = s->cars[i]->_laps;
    if (t.eliminated)
    {
        t.status = STATUS_KNOCKED_OUT;
        sdAiSetTask(i, AI_PARKED);
        if (!humanPlayer(s, i))
            s->cars[i]->_state |= RM_CAR_STATE_ELIMINATED;
        return;
    }
    t.status = STATUS_GARAGE;
    sdAiSetTask(i, AI_GARAGE);
}

int sectorBounds(double *bounds)
{
    tTrack *track = ReInfo->track;
    int count = std::min(track->numberOfSectors - 1, maxSectors - 1);
    int kept = 0;
    for (int k = 0; k < count; k++)
        if (track->sectors[k] > 0 && track->sectors[k] < track->length)
            bounds[kept++] = track->sectors[k];
    std::sort(bounds, bounds + kept);
    return kept;
}

bool timedLap(int i)
{
    return kind == KIND_RACE || timing[i].run == RUN_FLYING;
}

void improveSector(int i, int k, double time)
{
    Timing &t = timing[i];
    if (time <= 0)
        return;
    if (t.sectorBest[k] == 0 || time < t.sectorBest[k])
        t.sectorBest[k] = time;
    if (sessionSectors[k] == 0 || time < sessionSectors[k])
    {
        sessionSectors[k] = time;
        sessionSectorCars[k] = i;
    }
}

void noteSector(int i, int k, double time)
{
    timing[i].sectorNow[k] = time;
    if (timedLap(i) && !sdStewardsLapInvalid(i))
        improveSector(i, k, time);
}

void noteFastest(int i, double lap, int lapNumber, const double *trace)
{
    if (lap <= 0 || (fastestLap > 0 && lap >= fastestLap))
        return;
    fastestLap = lap;
    fastestCar = i;
    fastestLapNumber = lapNumber;
    std::copy(trace, trace + timingPoints + 1, fastestTrace);
}

void startSectorLap(Timing &t, int lap, bool fromLine, double distance, double clock)
{
    t.sectorLap = lap;
    t.fromLine = fromLine;
    t.nextBoundary = 0;
    t.lastDistance = distance;
    t.lastClock = clock;
    t.tracePoint = fromLine ? 0 : -1;
    t.trace[0] = 0;
    std::fill(t.splits, t.splits + maxSectors, 0.0);
    std::fill(t.sectorNow, t.sectorNow + maxSectors, 0.0);
}

void closeSectorLap(tCarElt *car, int i, int count)
{
    Timing &t = timing[i];
    if (car->_laps <= 1 || t.nextBoundary != count || (count == 0 && !t.fromLine))
        return;
    double lap = car->_lastLapTime;
    double from = count > 0 ? t.splits[count - 1] : 0.0;
    bool valid = timedLap(i) && !sdStewardsLastLapInvalid(i);
    t.sectorNow[count] = lap - from;
    if (valid)
        improveSector(i, count, t.sectorNow[count]);
    std::copy(t.sectorNow, t.sectorNow + maxSectors, t.sectorLast);
    if (!t.fromLine || !valid || t.tracePoint < timingPoints - 1)
        return;
    for (int p = t.tracePoint + 1; p < timingPoints; p++)
        t.trace[p] = t.trace[t.tracePoint];
    t.trace[timingPoints] = lap;
    noteFastest(i, lap, car->_laps - 1, t.trace);
}

void followTrace(Timing &t, double distance, double clock, double length)
{
    if (t.tracePoint < 0)
        return;
    int reached = std::min(timingPoints - 1, (int)floor(distance / length * timingPoints));
    for (int p = t.tracePoint + 1; p <= reached; p++)
    {
        double at = p * length / timingPoints;
        double span = distance - t.lastDistance;
        double share = span > 1e-6 ? (at - t.lastDistance) / span : 1.0;
        t.trace[p] = t.lastClock + (clock - t.lastClock) * std::max(0.0, std::min(1.0, share));
    }
    t.tracePoint = std::max(t.tracePoint, reached);
}

void clockSectors(tSituation *s, int i, const double *bounds, int count, double length)
{
    tCarElt *car = s->cars[i];
    Timing &t = timing[i];
    double distance = car->_distFromStartLine;
    double clock = car->_curLapTime;
    if (car->_laps != t.sectorLap)
    {
        bool crossed = t.sectorLap >= 0 && car->_laps == t.sectorLap + 1;
        t.lastLapFull = crossed && t.fromLine && t.nextBoundary == count;
        if (crossed)
            closeSectorLap(car, i, count);
        startSectorLap(t, car->_laps, crossed && distance < sectorJump, distance, clock);
        return;
    }
    double moved = distance - t.lastDistance;
    if (moved < -sectorJump || moved > sectorJump)
    {
        t.fromLine = false;
        t.tracePoint = -1;
        t.nextBoundary = count + 1;
    }
    else if (moved > 0)
    {
        while (t.nextBoundary < count && t.lastDistance < bounds[t.nextBoundary] && distance >= bounds[t.nextBoundary])
        {
            int k = t.nextBoundary;
            double share = (bounds[k] - t.lastDistance) / moved;
            double at = t.lastClock + (clock - t.lastClock) * share;
            t.splits[k] = at;
            if (k > 0 || t.fromLine)
                noteSector(i, k, at - (k == 0 ? 0.0 : t.splits[k - 1]));
            t.nextBoundary++;
        }
        followTrace(t, distance, clock, length);
    }
    t.lastDistance = distance;
    t.lastClock = clock;
}

void buildLineShape(double length)
{
    if (lineShapeReady)
        return;
    double total = 0;
    int steps = timingPoints * 8;
    double step = length / steps;
    lineShape[0] = 0;
    for (int k = 0; k < steps; k++)
    {
        total += step / std::max(1.0, sdAiLineSpeed(std::min(length - 0.01, (k + 0.5) * step)));
        if ((k + 1) % 8 == 0)
            lineShape[(k + 1) / 8] = total;
    }
    for (int p = 0; p <= timingPoints; p++)
        lineShape[p] /= std::max(1e-6, total);
    lineShapeReady = true;
}

double shapeAt(double distance, double length)
{
    double x = std::max(0.0, std::min(1.0, distance / length)) * timingPoints;
    int low = std::min(timingPoints - 1, (int)floor(x));
    return lineShape[low] + (lineShape[low + 1] - lineShape[low]) * (x - low);
}

void simulateSectors(int i, double lap)
{
    double length = sdAiLength();
    buildLineShape(length);
    double bounds[maxSectors];
    int count = sectorBounds(bounds);
    Timing &t = timing[i];
    double previous = 0;
    for (int k = 0; k <= count; k++)
    {
        double at = k < count ? lap * shapeAt(bounds[k], length) : lap;
        noteSector(i, k, at - previous);
        previous = at;
    }
    std::copy(t.sectorNow, t.sectorNow + maxSectors, t.sectorLast);
    double trace[timingPoints + 1];
    for (int p = 0; p <= timingPoints; p++)
        trace[p] = lap * lineShape[p];
    noteFastest(i, lap, 1, trace);
}

void recordRunLap(tSituation *s, int i, double lap, bool valid)
{
    Timing &t = timing[i];
    t.lastLap = lap;
    if (!valid || lap <= 0)
        return;
    t.segmentBest = lap;
    t.segmentBestAt = s->currentTime;
    t.segmentTimes[segment] = lap;
    if (t.bestLap == 0 || lap < t.bestLap)
        t.bestLap = lap;
}

void endRun(tSituation *s, int i)
{
    timing[i].run = RUN_DONE;
    if (onTrack == i)
        onTrack = -1;
    parkInGarage(s, i);
}

void launchRun(tSituation *s, int i)
{
    tCarElt *car = s->cars[i];
    Timing &t = timing[i];
    int compound = humanPlayer(s, i) && playerPitCompound >= 0 ? playerPitCompound : pushCompound();
    sdServiceCar(i, compound);
    sdCarSetFuel(i, qualifyingFuel);
    if (humanPlayer(s, i))
    {
        car->_laps = 0;
        playerQueued = false;
    }
    else
    {
        sdAiLeaveGarage(i);
        sdAiSetTask(i, AI_OUT_LAP);
    }
    t.lastLaps = car->_laps;
    t.pinned = false;
    t.run = RUN_OUT;
    t.runStart = s->currentTime;
    t.status = STATUS_OUT_LAP;
    onTrack = i;
}

void followRun(tSituation *s, int i)
{
    tCarElt *car = s->cars[i];
    Timing &t = timing[i];
    bool crossed = car->_laps != t.lastLaps;
    t.lastLaps = car->_laps;
    t.laps = car->_laps;
    if (crossed && t.run == RUN_OUT && !sdAiInPitLaneAt(car->_distFromStartLine, car->_trkPos.toMiddle))
    {
        t.run = RUN_FLYING;
        t.status = STATUS_PUSH_LAP;
        if (!humanPlayer(s, i))
        {
            sdAiSetTask(i, AI_PUSH_LAP);
            sdAiSetLapNoise(i, 1.0 + uniform(-lapNoiseSize, lapNoiseSize));
        }
        return;
    }
    if (crossed && t.run == RUN_FLYING)
    {
        recordRunLap(s, i, car->_lastLapTime, !sdStewardsLastLapInvalid(i));
        endRun(s, i);
        return;
    }
    if (s->currentTime - t.runStart > runTimeout)
        endRun(s, i);
}

int nextRunner(tSituation *s)
{
    if (playerQueued && !timing[0].eliminated && timing[0].run == RUN_WAITING)
        return 0;
    for (int i : runOrder)
        if (!timing[i].eliminated && timing[i].run == RUN_WAITING && !humanPlayer(s, i))
            return i;
    return -1;
}

bool segmentDone()
{
    for (const Timing &t : timing)
        if (!t.eliminated && t.run != RUN_DONE)
            return false;
    return true;
}

void buildRunOrder(tSituation *s)
{
    runOrder.clear();
    for (int i = 0; i < s->_ncars; i++)
        if (!timing[i].eliminated)
            runOrder.push_back(i);
    std::stable_sort(runOrder.begin(), runOrder.end(), [](int a, int b) {
        double ta = segment == 0 ? expectedLap(a) : timing[a].segmentTimes[segment - 1];
        double tb = segment == 0 ? expectedLap(b) : timing[b].segmentTimes[segment - 1];
        return ta > tb;
    });
}

void startSegment(tSituation *s, int number)
{
    segment = number;
    phase = PHASE_RUNNING;
    onTrack = -1;
    playerQueued = false;
    sdTyresSetTrackGrip(trackGripStart + (1.0 - trackGripStart) * (segment + 0.5) / segments);
    for (int i = 0; i < s->_ncars; i++)
    {
        Timing &t = timing[i];
        t.segmentBest = 0;
        t.segmentBestAt = 0;
        t.run = RUN_WAITING;
        parkInGarage(s, i);
    }
    buildRunOrder(s);
}

void qualifyingTick(tSituation *s)
{
    if (phase != PHASE_RUNNING)
        return;
    if (onTrack >= 0)
        followRun(s, onTrack);
    if (onTrack < 0)
    {
        int next = nextRunner(s);
        if (next >= 0)
            launchRun(s, next);
    }
    if (segmentDone())
        phase = PHASE_COMPLETE;
}

void simulateRun(tSituation *s, int i)
{
    double evolution = 1.0 - 0.01 * ((double)segment + 1.0) / 3.0 + 0.01;
    double lap = expectedLap(i) * evolution * (1.0 + uniform(-simulatedNoise, simulatedNoise));
    timing[i].run = RUN_FLYING;
    simulateSectors(i, lap);
    recordRunLap(s, i, lap, true);
    endRun(s, i);
}

void simulateRemaining(tSituation *s)
{
    for (int i = 0; i < s->_ncars; i++)
    {
        Timing &t = timing[i];
        if (!t.eliminated && t.run != RUN_DONE && !humanPlayer(s, i))
            simulateRun(s, i);
    }
    if (segmentDone())
        phase = PHASE_COMPLETE;
    updateOrder(s);
}

void trackContacts(tSituation *s)
{
    double now = s->currentTime;
    for (int i = 0; i < s->_ncars; i++)
    {
        Timing &t = timing[i];
        tCar *sim = &SimCarTable[i];
        bool nearCar = false;
        tCarElt *mine = s->cars[i];
        if (sim->collision & SEM_COLLISION_CAR)
            for (int k = 0; k < s->_ncars && !nearCar; k++)
                nearCar = k != i && hypot(s->cars[k]->_pos_X - mine->_pos_X, s->cars[k]->_pos_Y - mine->_pos_Y) < 7.5;
        if (nearCar)
        {
            if (now - t.lastContact > contactWindow)
            {
                t.contacts++;
                stats.contactEvents++;
                if (i == 0)
                    stats.playerContacts++;
            }
            t.lastContact = now;
        }
        bool wallHit = (sim->collision & SEM_COLLISION_XYSCENE) || ((sim->collision & SEM_COLLISION_CAR) && !nearCar);
        if (wallHit)
        {
            if (now - t.lastWall > contactWindow)
                stats.wallHits++;
            t.lastWall = now;
        }
    }
}

void beginRace(tSituation *s)
{
    int n = s->_ncars;
    sdTyresSetTrackGrip(raceTrackGrip);
    playerStartCompound = sdTyresCompound(0);
    playerChangedCompound = false;
    for (int i = 0; i < n; i++)
    {
        if (playerDriven(s->cars[i]))
            continue;
        sdCarSetFuel(i, std::min(100.0, totalLaps * raceFuelPerLap * std::max(1.0, ReInfo->track->length / raceFuelLapLength) + 2.0));
        const CarPlan &plan = plans[i];
        sdAiSetTask(i, AI_RACE);
        sdAiSetReaction(i, uniform(reactionLow, reactionHigh));
        timing[i].pitJitter = uniform(-1.2, 1.2) * std::min(1.0, totalLaps / 20.0 + 0.3);
        timing[i].weatherPatience = weatherUniform(weatherPatienceLow, weatherPatienceHigh);
        timing[i].weatherLook = weatherUniform(weatherLookLow, weatherLookHigh);
        int dry = plan.stints.empty() ? defaultRaceCompound : plan.stints[0].compound;
        int start = sdWeatherIdealCompound(sdWeatherFutureLine(0), dry);
        timing[i].weatherStop = start != dry;
        sdTyresService(i, start);
    }
}

void beginQualifying(tSituation *s)
{
    startSegment(s, 0);
}

}

bool sdFieldActive()
{
    return kind != KIND_SOLO;
}

int sdFieldBay(int garage, int seat)
{
    return firstTeamBay + garage * 2 + seat;
}

int sdPitCompound()
{
    return playerPitCompound;
}

double sdSessionStartClock()
{
    return -startDelay;
}

bool sdSessionStartPlace(int index, int slot, int bay, double *distance, double *lateral)
{
    if ((int)startSlots.size() <= index)
        startSlots.resize(index + 1, 0);
    startSlots[index] = slot;
    if ((int)carBays.size() <= index)
        carBays.resize(index + 1, -1);
    carBays[index] = bay;
    if (kind != KIND_QUALIFYING)
        return true;
    sdAiBoxOf(bay, distance, lateral);
    return false;
}

void sdSessionClearPlans()
{
    plans.clear();
}

void sdSessionBegin(tSituation *s)
{
    if (kind == KIND_SOLO)
        return;
    rng.seed(seed);
    weatherRng.seed(seed ^ 0x5bd1e995u);
    int n = s->_ncars;
    timing.assign(n, Timing());
    plans.resize(n);
    order.resize(n);
    previousOrder.clear();
    finishers = 0;
    chequered = false;
    stats = Stats();
    passLog.clear();
    phase = PHASE_RUNNING;
    std::fill(sessionSectors, sessionSectors + maxSectors, 0.0);
    std::fill(sessionSectorCars, sessionSectorCars + maxSectors, -1);
    fastestLap = 0;
    fastestCar = -1;
    fastestLapNumber = 0;
    int capacity = timingPoints * timingLaps;
    for (int i = 0; i < n; i++)
    {
        order[i] = i;
        timing[i].points.assign(capacity, 0.0);
        timing[i].lastLaps = s->cars[i]->_laps;
        sdEnergySetPerformance(i, plans[i].power);
    }
    sdAiSetPaceScale(difficultyScale);
    if (kind == KIND_RACE)
    {
        beginRace(s);
        std::stable_sort(order.begin(), order.end(), [](int a, int b) { return startSlots[a] < startSlots[b]; });
        for (int rank = 0; rank < n; rank++)
            timing[order[rank]].position = rank + 1;
    }
    else if (kind == KIND_QUALIFYING)
        beginQualifying(s);
    else
        for (int i = 0; i < n; i++)
            sdAiSetTask(i, AI_PUSH_LAP);
}

void sdSessionTick(tSituation *s)
{
    if (kind == KIND_SOLO || kind == KIND_LAPPING)
        return;
    double length = sdAiLength();
    for (int i = 0; i < s->_ncars; i++)
        recordTiming(s, i, length);
    if (kind == KIND_RACE)
        closeLapsRace(s);
    if (s->currentTime > 0 && kind == KIND_QUALIFYING)
        qualifyingTick(s);
    if (kind != KIND_RACE || s->currentTime > 0)
        updateOrder(s);
    updateGaps(s);
    if (kind == KIND_RACE)
        countOvertakes(s);
    if (s->currentTime <= 0 || kind != KIND_RACE)
        return;
    blueFlags(s);
    armOvertakes(s, length);
    raceStrategy(s);
    retireStuckCars(s);
    raceFinish(s);
}

void holdParked(tSituation *s)
{
    for (int i = 0; i < s->_ncars; i++)
    {
        const Timing &t = timing[i];
        if (!t.pinned || (t.status != STATUS_GARAGE && t.status != STATUS_KNOCKED_OUT))
            continue;
        tCar *car = &SimCarTable[i];
        car->DynGCg.pos.x = car->DynGC.pos.x = (tdble)t.pinX;
        car->DynGCg.pos.y = car->DynGC.pos.y = (tdble)t.pinY;
        car->DynGCg.pos.az = car->DynGC.pos.az = (tdble)t.pinYaw;
        car->DynGCg.vel.x = car->DynGCg.vel.y = car->DynGCg.vel.az = 0;
        car->DynGC.vel.x = car->DynGC.vel.y = car->DynGC.vel.az = 0;
    }
}

void sdSessionAfterStep(tSituation *s)
{
    if (kind == KIND_SOLO || kind == KIND_LAPPING)
        return;
    holdParked(s);
    trackContacts(s);
    double bounds[maxSectors];
    int count = sectorBounds(bounds);
    double length = ReInfo->track->length;
    for (int i = 0; i < s->_ncars && i < (int)timing.size(); i++)
        clockSectors(s, i, bounds, count, length);
}

int sdSessionKindOf()
{
    return kind;
}

int sdSessionTotalLaps()
{
    return totalLaps;
}

bool sdSessionRacing(int index)
{
    if (timing.empty() || index >= (int)timing.size())
        return true;
    const Timing &t = timing[index];
    if (t.finished || t.retired || t.eliminated || t.disqualified)
        return false;
    return t.status != STATUS_GARAGE && t.status != STATUS_KNOCKED_OUT && t.status != STATUS_QUEUED;
}

bool sdSessionFinished(int index)
{
    return !timing.empty() && index < (int)timing.size() && timing[index].finished;
}

double sdSessionReferenceLap()
{
    return referenceLap;
}

int sdSessionStartSlot(int index)
{
    return index < (int)startSlots.size() ? startSlots[index] : index;
}

bool sdSessionChequered()
{
    return chequered;
}

void sdSessionRestartTiming(tSituation *s)
{
    int capacity = timingPoints * timingLaps;
    double length = sdAiLength();
    for (int i = 0; i < (int)timing.size(); i++)
    {
        Timing &t = timing[i];
        tCarElt *car = s->cars[i];
        t.points.assign(capacity, s->currentTime);
        t.progress = carProgress(car, length);
        t.lastPoint = std::max(-1, (int)floor((t.progress + 1.0) * timingPoints));
        t.lastLaps = car->_laps;
        t.laps = car->_laps;
        t.gapLeader = 0;
        t.gapAhead = 0;
        t.lastDetect = car->_distFromStartLine;
    }
    previousOrder.clear();
}

int sdSessionPositionOf(int index)
{
    return timing.empty() || index >= (int)timing.size() ? 1 : timing[index].position;
}

void sdSessionDisqualify(int index)
{
    if (timing.empty() || index >= (int)timing.size())
        return;
    Timing &t = timing[index];
    t.disqualified = true;
    t.retired = true;
    t.status = STATUS_DISQUALIFIED;
    if (!playerDriven(ReInfo->s->cars[index]))
        ReInfo->s->cars[index]->_state |= RM_CAR_STATE_ELIMINATED;
}

bool sdSessionCarVisible(int index)
{
    if (timing.empty() || index >= (int)timing.size())
        return true;
    return timing[index].status != STATUS_KNOCKED_OUT && !timing[index].retired;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void sdSessionConfigure(int sessionKind, int laps, double difficulty, int randomSeed)
{
    kind = (Kind)sessionKind;
    totalLaps = laps;
    difficultyScale = difficulty;
    seed = (unsigned)randomSeed;
    std::mt19937 starter(seed);
    startDelay = kind == KIND_RACE ? 5.0 + std::uniform_real_distribution<double>(0.2, 3.0)(starter) : kind == KIND_QUALIFYING ? 0.5 : 2.0;
}

EMSCRIPTEN_KEEPALIVE void sdSessionReference(double lap)
{
    referenceLap = lap;
}

EMSCRIPTEN_KEEPALIVE void sdFieldPlan(int index, double speed, double raceSpeed, double power)
{
    if ((int)plans.size() <= index)
        plans.resize(index + 1);
    plans[index].speed = speed;
    plans[index].raceSpeed = raceSpeed;
    plans[index].power = power;
}

EMSCRIPTEN_KEEPALIVE void sdFieldStint(int index, int compound, double from)
{
    if ((int)plans.size() <= index)
        plans.resize(index + 1);
    plans[index].stints.push_back({compound, from});
}

EMSCRIPTEN_KEEPALIVE void sdSessionInfo(double *out)
{
    out[0] = kind;
    out[1] = phase;
    out[2] = segment;
    int toRun = 0;
    for (const Timing &t : timing)
        if (!t.eliminated && t.run != RUN_DONE)
            toRun++;
    out[3] = toRun;
    out[4] = totalLaps;
    out[5] = startDelay;
    out[6] = chequered ? 1 : 0;
    out[7] = timing.empty() || order.empty() ? 0 : timing[order[0]].laps;
    out[8] = sdStewardsLapInvalid(0) ? 1 : 0;
    out[9] = sdStewardsOffTracks(0);
    out[10] = timing.empty() ? 0 : playerQueued ? -1 : timing[0].run;
    out[11] = onTrack;
}

EMSCRIPTEN_KEEPALIVE void sdTiming(double *out)
{
    const int stride = 20;
    for (int i = 0; i < (int)timing.size(); i++)
    {
        const Timing &t = timing[i];
        double *c = &out[i * stride];
        c[0] = t.position;
        c[1] = t.status;
        c[2] = t.laps;
        c[3] = t.bestLap;
        c[4] = t.lastLap;
        c[5] = t.gapLeader;
        c[6] = t.gapAhead;
        c[7] = t.lapsDown;
        c[8] = sdTyresCompound(i);
        c[9] = sdTyresAge(i);
        c[10] = t.pits;
        c[11] = t.segmentBest;
        c[12] = t.disqualified ? 3 : t.finished ? 1 : t.retired ? 2 : 0;
        c[13] = t.finishTime + t.penalties + sdStewardsTimeAdded(i);
        c[14] = t.eliminated ? 1 : 0;
        c[15] = t.contacts;
        c[16] = t.progress;
        c[17] = sdEnergyOvertakeActive(i) ? 1 : 0;
        c[18] = sdAiInPitLane(i) ? 1 : 0;
        c[19] = i == 0 ? 0 : (int)sdAiTask(i);
    }
}

EMSCRIPTEN_KEEPALIVE void sdQualifyingTimes(int index, double *out)
{
    for (int i = 0; i < segments; i++)
        out[i] = timing[index].segmentTimes[i];
}

EMSCRIPTEN_KEEPALIVE int sdFieldSectors(double *out)
{
    int n = (int)timing.size();
    for (int i = 0; i < n; i++)
    {
        const Timing &t = timing[i];
        double *c = &out[i * sectorFields];
        for (int k = 0; k < maxSectors; k++)
        {
            c[k] = t.sectorNow[k];
            c[maxSectors + k] = t.sectorLast[k];
            c[2 * maxSectors + k] = t.sectorBest[k];
        }
    }
    double *tail = &out[n * sectorFields];
    for (int k = 0; k < maxSectors; k++)
    {
        tail[k] = sessionSectors[k];
        tail[maxSectors + k] = sessionSectorCars[k];
    }
    tail[2 * maxSectors] = fastestLap;
    tail[2 * maxSectors + 1] = fastestCar;
    tail[2 * maxSectors + 2] = fastestLapNumber;
    return n;
}

EMSCRIPTEN_KEEPALIVE int sdSessionBestTrace(double *out)
{
    for (int p = 0; p <= timingPoints; p++)
        out[p] = fastestTrace[p];
    return fastestCar;
}

EMSCRIPTEN_KEEPALIVE int sdSessionPasses(double *out, int max, int from)
{
    int total = (int)passLog.size();
    for (int k = std::max(0, from); k < total && k - from < max; k++)
    {
        const PassEvent &p = passLog[k];
        double *row = &out[(k - from) * 5];
        row[0] = p.time;
        row[1] = p.passer;
        row[2] = p.passed;
        row[3] = p.position;
        row[4] = p.lap;
    }
    return total;
}

EMSCRIPTEN_KEEPALIVE void sdSessionStats(double *out)
{
    out[0] = stats.contactEvents;
    out[1] = stats.playerContacts;
    out[2] = stats.wallHits;
    out[3] = stats.overtakes;
    int offTracks = 0;
    for (int i = 0; i < (int)timing.size(); i++)
        offTracks += sdStewardsOffTracks(i);
    out[4] = offTracks;
    out[5] = stats.pits;
}

EMSCRIPTEN_KEEPALIVE int sdSessionPlayerRun()
{
    if (kind != KIND_QUALIFYING || phase != PHASE_RUNNING || timing.empty())
        return 0;
    Timing &t = timing[0];
    if (t.eliminated || t.run != RUN_WAITING || playerQueued)
        return 0;
    playerQueued = true;
    t.status = STATUS_QUEUED;
    if (onTrack > 0)
        simulateRun(ReInfo->s, onTrack);
    return 1;
}

EMSCRIPTEN_KEEPALIVE int sdSessionAdvance()
{
    tSituation *s = ReInfo->s;
    if (kind != KIND_QUALIFYING || phase != PHASE_COMPLETE)
        return 0;
    updateOrder(s);
    int knockouts = segmentKnockouts[segment];
    int alive = 0;
    for (int i : order)
        if (!timing[i].eliminated)
            alive++;
    int out = 0;
    std::vector<int> ranked;
    for (int i : order)
        if (!timing[i].eliminated)
            ranked.push_back(i);
    for (int rank = alive - knockouts; rank < alive; rank++)
    {
        int i = ranked[rank];
        timing[i].eliminated = true;
        timing[i].knockedRank = 100 - (segment * 30) + (rank - (alive - knockouts));
        out++;
    }
    if (segment + 1 >= segments)
    {
        phase = PHASE_WEEKEND_DONE;
        return 2;
    }
    startSegment(s, segment + 1);
    updateOrder(s);
    return 1;
}

EMSCRIPTEN_KEEPALIVE void sdSessionSimulate()
{
    if (kind == KIND_QUALIFYING && phase != PHASE_COMPLETE && phase != PHASE_WEEKEND_DONE)
        simulateRemaining(ReInfo->s);
}

EMSCRIPTEN_KEEPALIVE int sdSessionStartTyres(int compound)
{
    if (kind == KIND_QUALIFYING || ReInfo->s->currentTime > 0)
        return 0;
    sdTyresService(0, compound);
    playerStartCompound = sdTyresCompound(0);
    playerChangedCompound = false;
    return 1;
}

EMSCRIPTEN_KEEPALIVE void sdSessionPitCompound(int compound)
{
    playerPitCompound = compound;
}

EMSCRIPTEN_KEEPALIVE int sdSessionGrid(int *out)
{
    std::vector<double> key(order.size());
    for (int rank = 0; rank < (int)order.size(); rank++)
    {
        int drop = sdStewardsGridDrop(order[rank]);
        key[order[rank]] = rank + (drop > 0 ? drop + 0.5 : 0.0);
    }
    std::vector<int> grid = order;
    std::stable_sort(grid.begin(), grid.end(), [&](int a, int b) { return key[a] < key[b]; });
    for (int i = 0; i < (int)grid.size(); i++)
        out[i] = grid[i];
    return (int)grid.size();
}

}
