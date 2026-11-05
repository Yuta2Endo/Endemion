// Игры Legal Center в порядке показа. OS Developer Simulator сюда не входит (решение владельца 2026-11-05)

import { endemionLife } from "./endemion-life.js";
import { liforae } from "./liforae.js";
import { littleWeather } from "./little-weather.js";
import { tetrus } from "./tetrus.js";

/** Дата последнего обновления всех документов (ISO). Меняйте вместе с текстами */
export const LEGAL_UPDATED = "2026-11-05";

export const LEGAL_GAMES = [tetrus, littleWeather, liforae, endemionLife];

const BY_SLUG = new Map(LEGAL_GAMES.map((game) => [game.slug, game]));

export function legalGame(slug) {
  return BY_SLUG.get(slug) || null;
}
