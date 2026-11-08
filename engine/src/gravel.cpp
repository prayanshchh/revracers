#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <unordered_map>
#include <vector>

#include <tgf.h>
#include <track.h>
#include <robottools.h>

#include "game.h"

extern "C" void __real__Z19RtTrackGlobal2LocalP8trackSegffP9TrkLocPosi(tTrackSeg *seg, tdble x, tdble y, tTrkLocPos *p, int type);

namespace
{
const char *const gravelMaterial = "track-gravel";
const char *const bedsSection = "Gravel Beds";
const char *const sealedSection = "Sealed Run-off";
const double rowMetres = 1.0;
const double cellMetres = 0.25;
const double reach = 64.0;
const int columns = (int)(2 * reach / cellMetres);
const int words = (columns + 63) / 64;

struct Beds
{
    std::vector<uint64_t> bits;
    std::vector<uint64_t> sealed;
    int rows = 0;
    tTrackSurface *surface = nullptr;
    std::unordered_map<const tTrackSeg *, tTrackSeg *> clones;
    std::vector<tTrackSeg *> owned;
};

Beds beds;

void clearBeds()
{
    for (tTrackSeg *seg : beds.owned)
        free(seg);
    beds.owned.clear();
    beds.clones.clear();
    beds.bits.clear();
    beds.sealed.clear();
    beds.rows = 0;
    beds.surface = nullptr;
}

tTrackSurface *gravelSurface(tTrack *track)
{
    for (tTrackSurface *s = track->surfaces; s; s = s->next)
        if (strcmp(s->material, gravelMaterial) == 0)
            return s;
    char path[128];
    snprintf(path, sizeof(path), "%s/%s", TRK_SECT_SURFACES, gravelMaterial);
    if (!GfParmExistsSection(track->params, path))
        return nullptr;
    tTrackSurface *s = (tTrackSurface *)calloc(1, sizeof(tTrackSurface));
    s->material = gravelMaterial;
    s->kFriction = s->kFrictionDry = GfParmGetNum(track->params, path, TRK_ATT_FRICTION, nullptr, 0.6f);
    s->kRollRes = GfParmGetNum(track->params, path, TRK_ATT_ROLLRES, nullptr, 0.12f);
    s->kRoughness = GfParmGetNum(track->params, path, TRK_ATT_ROUGHT, nullptr, 0.0f) / 2.0f;
    s->kRoughWaveLen = (tdble)(2.0 * PI / GfParmGetNum(track->params, path, TRK_ATT_ROUGHTWL, nullptr, 1.0f));
    s->kDammage = GfParmGetNum(track->params, path, TRK_ATT_DAMMAGE, nullptr, 10.0f);
    s->kRebound = GfParmGetNum(track->params, path, TRK_ATT_REBOUND, nullptr, 0.5f);
    s->next = track->surfaces;
    track->surfaces = s;
    return s;
}

void mark(std::vector<uint64_t> &bits, double distance, double from, double to)
{
    int row = (int)std::floor(distance / rowMetres) % beds.rows;
    if (row < 0)
        row += beds.rows;
    int first = std::max(0, (int)std::floor((from + reach) / cellMetres));
    int last = std::min(columns - 1, (int)std::floor((to + reach) / cellMetres));
    uint64_t *line = &bits[(size_t)row * words];
    for (int c = first; c <= last; c++)
        line[c >> 6] |= 1ull << (c & 63);
}

void readSpans(tTrack *track, const char *section, std::vector<uint64_t> &bits)
{
    bits.assign((size_t)beds.rows * words, 0);
    char path[128];
    for (int entry = 0;; entry++)
    {
        snprintf(path, sizeof(path), "spans %03d", entry);
        const char *text = GfParmGetStr(track->params, section, path, nullptr);
        if (!text)
            break;
        const char *cursor = text;
        while (*cursor)
        {
            char *end = nullptr;
            double distance = strtod(cursor, &end);
            if (end == cursor || *end != ',')
                break;
            double from = strtod(end + 1, &end);
            if (*end != ',')
                break;
            double to = strtod(end + 1, &end);
            mark(bits, distance, from, to);
            cursor = *end == ';' ? end + 1 : end;
        }
    }
}

void cloneSide(tTrackSeg *side)
{
    if (!side || beds.clones.count(side))
        return;
    tTrackSeg *copy = (tTrackSeg *)malloc(sizeof(tTrackSeg));
    memcpy(copy, side, sizeof(tTrackSeg));
    copy->surface = beds.surface;
    beds.clones[side] = copy;
    beds.owned.push_back(copy);
}

void cloneSides(tTrack *track)
{
    tTrackSeg *start = track->seg;
    tTrackSeg *seg = start;
    do
    {
        for (tTrackSeg *side = seg->lside; side; side = side->lside)
            if (side->type2 == TR_LSIDE)
                cloneSide(side);
        for (tTrackSeg *side = seg->rside; side; side = side->rside)
            if (side->type2 == TR_RSIDE)
                cloneSide(side);
        seg = seg->next;
    } while (seg && seg != start);
}

bool cellSet(const std::vector<uint64_t> &bits, double distance, double lateral)
{
    if (beds.rows == 0 || bits.empty() || std::fabs(lateral) >= reach)
        return false;
    int row = (int)std::floor(distance / rowMetres) % beds.rows;
    if (row < 0)
        row += beds.rows;
    int c = (int)std::floor((lateral + reach) / cellMetres);
    return (bits[(size_t)row * words + (c >> 6)] >> (c & 63)) & 1ull;
}

bool onBed(double distance, double lateral)
{
    return cellSet(beds.bits, distance, lateral);
}
}

void sdGravelInit(tTrack *track)
{
    clearBeds();
    beds.surface = gravelSurface(track);
    if (!beds.surface)
        return;
    beds.rows = std::max(1, (int)std::ceil(track->length / rowMetres));
    readSpans(track, bedsSection, beds.bits);
    readSpans(track, sealedSection, beds.sealed);
    cloneSides(track);
}

bool sdGravelSealedAt(tTrackSeg *near, double x, double y)
{
    if (!beds.surface || !near)
        return false;
    tTrkLocPos main;
    __real__Z19RtTrackGlobal2LocalP8trackSegffP9TrkLocPosi(near, (tdble)x, (tdble)y, &main, TR_LPOS_MAIN);
    return cellSet(beds.sealed, RtGetDistFromStart2(&main), main.toMiddle);
}

extern "C" void __wrap__Z19RtTrackGlobal2LocalP8trackSegffP9TrkLocPosi(tTrackSeg *seg, tdble x, tdble y, tTrkLocPos *p, int type)
{
    __real__Z19RtTrackGlobal2LocalP8trackSegffP9TrkLocPosi(seg, x, y, p, type);
    if (type != TR_LPOS_SEGMENT || !beds.surface || !p->seg)
        return;
    auto clone = beds.clones.find(p->seg);
    if (clone == beds.clones.end())
        return;
    tTrkLocPos main;
    __real__Z19RtTrackGlobal2LocalP8trackSegffP9TrkLocPosi(seg, x, y, &main, TR_LPOS_MAIN);
    if (onBed(RtGetDistFromStart2(&main), main.toMiddle))
        p->seg = clone->second;
}
