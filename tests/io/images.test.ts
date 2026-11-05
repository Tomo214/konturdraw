import { describe, expect, it } from 'vitest';
import { ImageStore } from '../../src/io/images';

describe('Bildablage', () => {
  it('liefert genau die verlangten Bilder', () => {
    const s = new ImageStore();
    s.add({ aa: 'QQ==', bb: 'Qg==' });
    expect(s.pick(['bb'])).toEqual({ bb: 'Qg==' });
    expect(s.pick([])).toEqual({});
  });

  it('fehlendes Bild → deutsche Fehlermeldung', () => {
    expect(() => new ImageStore().pick(['cc'])).toThrow(/Bild cc fehlt/);
  });

  it('unbekannter Hash: nichts zu zeichnen', () => {
    expect(new ImageStore().bitmap('zz')).toBeNull();
  });
});
