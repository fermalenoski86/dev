import { PRESET_EMPTY, PRESET_TAKEOVER_15S, type TakeoverDraft } from '@trust/show-authoring';
import { describe, expect, it } from 'vitest';
import { screensOutsideContract, screensUsedByDraft } from './surfaces';

const hold = { mode: 'hold' as const };
const play = { mode: 'play' as const, fromMs: 0 };
const black = { mode: 'black' as const };

function con(draft: TakeoverDraft, cambios: Partial<TakeoverDraft['surfaces']>, pantallas: Partial<TakeoverDraft['moments'][number]['screens']>): TakeoverDraft {
  return {
    ...draft,
    surfaces: { ...draft.surfaces, ...cambios },
    moments: draft.moments.map((m) => ({ ...m, screens: { upper: hold, corrientes: hold, pellegrini: hold, horizontal: hold, ...pantallas } })),
  };
}

describe('CRITERIO D1 (§6): pantallas que usa un draft', () => {
  it('master: upper → A y B; horizontal aparte', () => {
    expect(screensUsedByDraft(PRESET_TAKEOVER_15S())).toEqual(['horizontal', 'screen_a', 'screen_b']);
    expect(screensUsedByDraft(con(PRESET_EMPTY(), { upperMode: 'master' }, { upper: play }))).toEqual(['screen_a', 'screen_b']);
  });

  it('master con includeHorizontalInMaster: upper arrastra la horizontal', () => {
    expect(screensUsedByDraft(con(PRESET_EMPTY(), { upperMode: 'master', includeHorizontalInMaster: true }, { upper: play }))).toEqual(['horizontal', 'screen_a', 'screen_b']);
  });

  it('independent: corrientes → A, pellegrini → B; upper se ignora', () => {
    expect(screensUsedByDraft(con(PRESET_EMPTY(), { upperMode: 'independent' }, { corrientes: play, upper: play }))).toEqual(['screen_a']);
    expect(screensUsedByDraft(con(PRESET_EMPTY(), { upperMode: 'independent' }, { pellegrini: black }))).toEqual(['screen_b']);
  });

  it('black también es usar la pantalla; hold no', () => {
    expect(screensUsedByDraft(con(PRESET_EMPTY(), { upperMode: 'master' }, { horizontal: black }))).toEqual(['horizontal']);
    expect(screensUsedByDraft(con(PRESET_EMPTY(), { upperMode: 'master' }, {}))).toEqual([]);
  });

  it('fuera de contrato: solo lo que el contrato no incluye', () => {
    expect(screensOutsideContract(PRESET_TAKEOVER_15S(), ['screen_a', 'screen_b'])).toEqual(['horizontal']);
    expect(screensOutsideContract(PRESET_TAKEOVER_15S(), ['screen_a', 'screen_b', 'horizontal'])).toEqual([]);
  });
});
