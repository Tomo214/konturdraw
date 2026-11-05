<script lang="ts">
  // Zahlenfeld der Eigenschaftsleiste: Enter oder Verlassen übernimmt (ein Rückgängig-Schritt), Esc verwirft.
  // Unlesbares springt auf den alten Wert zurück; der neue kommt mit dem nächsten Bild aus dem Dokument.
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  let {
    text,
    tip,
    label,
    icon,
    suffix = '',
    width = 64,
    parse,
    onset,
  }: {
    text: string;
    tip: string;
    label?: string;
    icon?: IconName;
    suffix?: string;
    width?: number;
    parse: (s: string) => number | null;
    onset: (v: number) => void;
  } = $props();

  function commit(e: Event & { currentTarget: HTMLInputElement }) {
    const v = parse(e.currentTarget.value);
    e.currentTarget.value = text;
    if (v !== null) onset(v);
  }

  function onkeydown(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (e.key === 'Escape') e.currentTarget.value = text;
    if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
  }
</script>

<label class="num" data-tip={tip} data-tip-side="below">
  {#if icon}<Icon name={icon} size={16} />{:else if label}<span class="label">{label}</span>{/if}
  <input
    type="text"
    inputmode="decimal"
    spellcheck="false"
    aria-label={tip}
    value={text}
    style:width="{width}px"
    onchange={commit}
    {onkeydown}
    onfocus={(e) => e.currentTarget.select()}
  />
  {#if suffix}<span class="suffix">{suffix}</span>{/if}
</label>

<style>
  .num {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-dim);
  }
  .label {
    min-width: 9px;
    font-weight: 600;
  }
  .suffix {
    min-width: 14px;
  }
  input {
    color: var(--text-strong);
  }
</style>
