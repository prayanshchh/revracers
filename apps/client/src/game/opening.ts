import { LoadShow } from "./load-show.ts";
import { openingShow } from "./school-early.ts";

const status = document.querySelector<HTMLElement>(
  "[data-testid=drive-status]",
);

export const loadShow = openingShow() && status ? new LoadShow(status) : null;
loadShow?.arm();
