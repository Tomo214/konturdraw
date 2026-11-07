// Englisches Wörterbuch, nach Bereichen getrennt; Schlüssel = deutscher Text.
import { MENUS } from './menus';
import { MESSAGES } from './messages';
import { UI } from './ui';

export { MESSAGES };
export const PARTS: Record<string, Record<string, string>> = { MENUS, MESSAGES, UI };
export const EN: Record<string, string> = { ...MENUS, ...UI, ...MESSAGES };
