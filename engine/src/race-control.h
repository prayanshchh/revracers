#ifndef SD_WEB_RACE_CONTROL_H
#define SD_WEB_RACE_CONTROL_H

#include <raceman.h>

void sdRaceControlBegin(tSituation *s, int kind);
void sdRaceControlTick(tSituation *s, double dt);
bool sdRaceControlHolding(tSituation *s);
bool sdRaceControlNeutralised();
bool sdRaceControlRacingHeld();
double sdRaceControlSinceSignal(tSituation *s);

#endif
