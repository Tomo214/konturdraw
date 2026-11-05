<script lang="ts">
  import { ICONS, type IconName, type IconPath } from './icons';

  let { name, size = 20 }: { name: IconName; size?: number } = $props();
  const d = $derived<IconPath>(ICONS[name]);
  const [main, dim] = $derived(typeof d === 'string' ? [d, ''] : d);
</script>

<svg
  viewBox="0 0 20 20"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  >{#if dim}<path d={dim} opacity="0.45" />{/if}<path d={main} /></svg
>

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
