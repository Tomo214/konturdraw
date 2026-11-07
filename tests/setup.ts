// Tests prüfen deutsche Texte; Node meldet en-US als Systemsprache.
import { setLang } from '../src/i18n/i18n.svelte';

setLang('de');
