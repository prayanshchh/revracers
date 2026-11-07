import asphaltBaseUrl from "../../../../content/tracks/training-ground/textures/asphalt_base.webp?url";
import asphaltBaseFirstUrl from "../../../../content/tracks/training-ground/textures/asphalt_base_first.webp?url";
import asphaltNormalUrl from "../../../../content/tracks/training-ground/textures/asphalt_normal.webp?url";
import asphaltNormalFirstUrl from "../../../../content/tracks/training-ground/textures/asphalt_normal_first.webp?url";
import asphaltRoughnessUrl from "../../../../content/tracks/training-ground/textures/asphalt_roughness.webp?url";
import streaksUrl from "../../../../content/tracks/training-ground/textures/asphalt_streaks.webp?url";
import concreteBaseUrl from "../../../../content/tracks/training-ground/textures/concrete_base.webp?url";
import concreteNormalUrl from "../../../../content/tracks/training-ground/textures/concrete_normal.webp?url";
import grassBaseUrl from "../../../../content/tracks/training-ground/textures/grass_base.webp?url";
import grassNormalUrl from "../../../../content/tracks/training-ground/textures/grass_normal.webp?url";
import paintNormalUrl from "../../../../content/tracks/training-ground/textures/paint_normal.webp?url";
import paintRoughnessUrl from "../../../../content/tracks/training-ground/textures/paint_roughness.webp?url";
import paintWhiteUrl from "../../../../content/tracks/training-ground/textures/paint_white.webp?url";
import tecproUrl from "../../../../content/tracks/training-ground/textures/tecpro_base.webp?url";
import terrainUrl from "../../../../content/tracks/training-ground/textures/terrain.webp?url";

export const trainingMaps = {
  asphaltBase: asphaltBaseFirstUrl,
  asphaltNormal: asphaltNormalFirstUrl,
  asphaltRoughness: asphaltRoughnessUrl,
  streaks: streaksUrl,
  concreteBase: concreteBaseUrl,
  concreteNormal: concreteNormalUrl,
  grassBase: grassBaseUrl,
  grassNormal: grassNormalUrl,
  paintNormal: paintNormalUrl,
  paintRoughness: paintRoughnessUrl,
  paintWhite: paintWhiteUrl,
  tecpro: tecproUrl,
  terrain: terrainUrl,
};

export const trainingUpgrades = {
  asphaltBase: asphaltBaseUrl,
  asphaltNormal: asphaltNormalUrl,
};

export const trainingTextures = Object.values(trainingMaps);
