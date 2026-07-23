import { describe, expect, it } from 'vitest';
import { slugFromTitle } from './slug';

describe('slugFromTitle parity with Backend normalize_slug', () => {
  const parityCases: Array<[title: string, expected: string]> = [
    ["Adam's Amazing Pasta", 'adam-s-amazing-pasta'],
    ['Café Crème Brûlée', 'cafe-creme-brulee'],
    ['Ünïcödé Fëast', 'unicode-feast'],
    ['Rødgrød med Fløde', 'rdgrd-med-flde'],
    ["Bjørn's Cookies", 'bjrn-s-cookies'],
    ['Łódź Bagels & ß-Pretzels', 'odz-bagels-pretzels'],
    ['  Leading and trailing  ', 'leading-and-trailing'],
    ['Spicy!!! Tofu??? (v2)', 'spicy-tofu-v2'],
    ['MiXeD CaSe TITLE', 'mixed-case-title'],
    ['a—b–c', 'abc'],
    ['naïve façade', 'naive-facade'],
    ['100% Vegan Chili #2', '100-vegan-chili-2'],
    ['þorramatur ðelight', 'orramatur-elight'],
    ['豆腐カレー', ''],
    ['🌮🌮🌮', ''],
  ];

  it.each(parityCases)('derives %j → %j exactly as the server would', (title, expected) => {
    expect(slugFromTitle(title)).toBe(expected);
  });
});
