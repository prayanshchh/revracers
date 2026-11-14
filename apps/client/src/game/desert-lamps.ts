export interface LampSpot {
  head: number[];
  aim: number[];
  gain: number;
  reach: number;
}

export const lampGains = {
  road: 4.5,
  lot: 1.8,
  plaza: 8,
  wall: 2.2,
  shade: 2.4,
  tower: 6,
  cabin: 0.7,
  pit: 1.1,
};
