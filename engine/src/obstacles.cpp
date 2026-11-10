#include <algorithm>
#include <cmath>
#include <vector>
#include <emscripten/emscripten.h>

#include "sim.h"
#include "game.h"

namespace
{

struct Post
{
    double x, y, radius;
};

struct Outline
{
    double front, rear, left, right;
};

std::vector<Post> posts;
const double skin = 0.02;
const double hardestStop = 0.25;
const double furthestShift = 0.05;
const double approachShare = 1.5;

Outline outlineOf(const tCar *car)
{
    Outline box = {-1e9, 1e9, -1e9, 1e9};
    for (int i = 0; i < 4; i++)
    {
        double along = car->corner[i].pos.x + car->statGC.x;
        double across = car->corner[i].pos.y + car->statGC.y;
        box.front = std::max(box.front, along);
        box.rear = std::min(box.rear, along);
        box.left = std::max(box.left, across);
        box.right = std::min(box.right, across);
    }
    return box;
}

void block(tCar *car, const Outline &box, const Post &post)
{
    tDynPt &dyn = car->DynGCg;
    double c = cos(dyn.pos.az);
    double s = sin(dyn.pos.az);
    double dx = post.x - dyn.pos.x;
    double dy = post.y - dyn.pos.y;
    double along = dx * c + dy * s;
    double across = -dx * s + dy * c;
    double nearAlong = std::min(box.front, std::max(box.rear, along));
    double nearAcross = std::min(box.left, std::max(box.right, across));
    double reach = post.radius + skin;
    double gap = hypot(along - nearAlong, across - nearAcross);
    if (gap >= reach)
        return;
    double nx = 0.0;
    double ny = 0.0;
    double depth = reach - gap;
    if (gap > 1e-6)
    {
        nx = (along - nearAlong) / gap;
        ny = (across - nearAcross) / gap;
    }
    else
    {
        double toFront = box.front - along;
        double toRear = along - box.rear;
        double toLeft = box.left - across;
        double toRight = across - box.right;
        double least = std::min(std::min(toFront, toRear), std::min(toLeft, toRight));
        nx = least == toFront ? 1.0 : least == toRear ? -1.0 : 0.0;
        ny = nx != 0.0 ? 0.0 : least == toLeft ? 1.0 : -1.0;
        nearAlong = nx > 0 ? box.front : nx < 0 ? box.rear : along;
        nearAcross = ny > 0 ? box.left : ny < 0 ? box.right : across;
        depth = least + reach;
    }
    double wx = nx * c - ny * s;
    double wy = nx * s + ny * c;
    double armX = nearAlong * c - nearAcross * s;
    double armY = nearAlong * s + nearAcross * c;
    double closing = (dyn.vel.x - dyn.vel.az * armY) * wx + (dyn.vel.y + dyn.vel.az * armX) * wy;
    if (closing <= 0.0)
        return;
    double turn = armX * wy - armY * wx;
    double give = car->Minv + turn * turn * car->Iinv.z;
    double impulse = std::min(closing, hardestStop) / give;
    dyn.vel.x -= (tdble)(impulse * car->Minv * wx);
    dyn.vel.y -= (tdble)(impulse * car->Minv * wy);
    dyn.vel.az -= (tdble)(impulse * turn * car->Iinv.z);
    double shift = std::min(depth, std::max(furthestShift, closing * SimDeltaTime * approachShare));
    dyn.pos.x -= (tdble)(wx * shift);
    dyn.pos.y -= (tdble)(wy * shift);
}

}

void sdObstaclesStep(tSituation *s)
{
    if (posts.empty() || s->_ncars < 1 || sdPlayerAutopilot())
        return;
    tCarElt *elt = s->cars[0];
    if (elt->_state & RM_CAR_STATE_NO_SIMU)
        return;
    tCar *car = &SimCarTable[0];
    Outline box = outlineOf(car);
    for (const Post &post : posts)
        block(car, box, post);
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void sdObstacles(const double *circles, int count)
{
    posts.resize((size_t)std::max(0, count));
    for (int i = 0; i < count; i++)
        posts[(size_t)i] = {circles[i * 3], circles[i * 3 + 1], circles[i * 3 + 2]};
}

}
