import json

RUNOFF = 0.25
KERB_WIDTH = 1.5


def survey(source, xy, values, length, kappa, found):
    measured = json.loads((source / "surface.json").read_text())
    return {
        "runoff": RUNOFF,
        "kerbs": [{**kerb, "width": KERB_WIDTH} for kerb in measured["kerbs"]],
        "gravel": measured["gravel"],
        "sealed": measured["sealed"],
    }
