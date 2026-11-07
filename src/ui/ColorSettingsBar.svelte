<script lang="ts">
  // Dokument-Farbeinstellungen (3f): Modus, CMYK-Druckprofil, Wiedergabe, Soft-Proof. Gilt für Anzeige, PDF, Druck.
  import { onMount } from 'svelte';
  import * as bridge from '../io/bridge';
  import { display } from '../io/colors';
  import { DEFAULT_COLOR_SETTINGS } from '../model/color';
  import type { History } from '../model/history';
  import type { ColorSettings, Doc } from '../model/types';
  import { N_, tm, tr } from '../i18n/i18n.svelte';

  interface Props {
    history: History<Doc>;
    proof: boolean;
    ondone(): void;
    onnotice(msg: string): void;
  }
  let { history, proof = $bindable(), ondone, onnotice }: Props = $props();
  let profiles = $state<bridge.CmykProfile[]>([]);
  // Anzeige folgt dem Dokument (App: display.use bei jedem Zeichnen) – so auch nach Rückgängig.
  const s = $derived(display.settings);
  // Ein Rückgängig-Schritt je Änderung; Basis ist das Dokument selbst (die Anzeige zieht erst im nächsten Bild nach).
  function onchange(patch: Partial<ColorSettings>) {
    history.push({ ...history.current, color: { ...(history.current.color ?? DEFAULT_COLOR_SETTINGS), ...patch } });
    ondone();
  }
  // Eigenes Profil außerhalb der Systemordner trotzdem in der Liste zeigen.
  const listed = $derived(
    s.cmykProfile && !profiles.some((p) => p.path === s.cmykProfile)
      ? [...profiles, { name: s.cmykProfile.split(/[\\/]/).pop() ?? s.cmykProfile, path: s.cmykProfile }]
      : profiles,
  );
  const PICK = '?datei';
  const INTENTS: [ColorSettings['intent'], string][] = [
    ['relative', N_('relativ farbmetrisch')],
    ['perceptual', N_('wahrnehmungsorientiert')],
    ['saturation', N_('Sättigung')],
    ['absolute', N_('absolut farbmetrisch')],
  ];
  const value = (e: Event) => (e.currentTarget as HTMLSelectElement).value;

  onMount(() => {
    bridge.listCmykProfiles().then((p) => (profiles = p), () => {});
  });

  async function setProfile(v: string, select: HTMLSelectElement) {
    if (v !== PICK) return onchange({ cmykProfile: v || null });
    select.value = s.cmykProfile ?? ''; // Abbruch → bisheriges Profil bleibt gewählt
    try {
      const p = await bridge.pickCmykProfile();
      if (p) onchange({ cmykProfile: p.path });
    } catch (e) {
      onnotice((e as Error).message);
    }
  }
</script>

<div class="form">
  <label class="row">
    <span>{tr('Farbmodus')}</span>
    <select value={s.mode} onchange={(e) => onchange({ mode: value(e) as ColorSettings['mode'] })}>
      <option value="rgb">RGB</option>
      <option value="cmyk">CMYK</option>
    </select>
  </label>
  <label class="row">
    <span>{tr('Druckprofil')}</span>
    <select value={s.cmykProfile ?? ''} onchange={(e) => setProfile(value(e), e.currentTarget)}>
      <option value="">{tr('Systemprofil')}</option>
      {#each listed as p (p.path)}
        <option value={p.path}>{p.name}</option>
      {/each}
      <option value={PICK}>{tr('Datei …')}</option>
    </select>
  </label>
  <label class="row">
    <span>{tr('Wiedergabe')}</span>
    <select value={s.intent} onchange={(e) => onchange({ intent: value(e) as ColorSettings['intent'] })}>
      {#each INTENTS as [v, label] (v)}
        <option value={v}>{tr(label)}</option>
      {/each}
    </select>
  </label>
  <label class="check wide"><input type="checkbox" checked={proof} onchange={(e) => ((proof = e.currentTarget.checked), ondone())} /> {tr('Soft-Proof (Druckfarben am Bildschirm)')}</label>
  <hr />
  <span>{tr('Anzeige')}</span>
  <span class="hint" class:error={!!display.error}>{display.error ? tm(display.error) : (display.profile ?? tr('ohne Profil (einfache Formel)'))}</span>
</div>

<style>
  .error {
    color: var(--accent);
  }
</style>
