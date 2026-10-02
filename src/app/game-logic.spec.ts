import { describe, expect, it } from 'vitest';
import { cardDamage, createBattle, createPlayer, createShopCard, endTurn, playCard, upgradeDeck } from './game-logic';

describe('shop attacks', () => {
  it('deals 15 damage and grants 15 shield for one energy with water', () => {
    const card = createShopCard('WATER', 'water');
    const battle = createBattle('BOSS', createPlayer(), [card]);
    const next = playCard(battle, card.id);
    expect(next.enemy.hp).toBe(285);
    expect(next.player.block).toBe(15);
    expect(next.energy).toBe(2);
    expect(battle.enemy.hp).toBe(300);
  });

  it('chains fire copies within and across turns and resets after a missed turn', () => {
    const cards = Array.from({ length: 3 }, (_, i) => createShopCard('FIRE', `fire-${i}`));
    let battle = createBattle('BOSS', createPlayer(), cards, () => 0);
    battle = playCard(battle, battle.hand[0]!.id);
    expect(battle.enemy.hp).toBe(285);
    expect(cardDamage(battle.hand[0]!, battle)).toBe(30);
    battle = playCard(battle, battle.hand[0]!.id);
    expect(battle.enemy.hp).toBe(255);
    battle = endTurn(battle, () => 0);
    expect(cardDamage(battle.hand[0]!, battle)).toBe(45);
    battle = playCard(battle, battle.hand[0]!.id);
    expect(battle.enemy.hp).toBe(210);
    battle = endTurn(battle, () => 0);
    battle = endTurn(battle, () => 0);
    expect(cardDamage(battle.hand[0]!, battle)).toBe(15);
    battle = playCard(battle, battle.hand[0]!.id);
    expect(battle.enemy.hp).toBe(195);
    expect(battle.fireChainUses).toBe(1);
    expect(createBattle('BOSS', createPlayer(), cards).fireChainUses).toBe(0);
  });

  it('compounds rest multipliers on damage and fire bonuses while preserving shield', () => {
    const cards = upgradeDeck([createShopCard('WATER', 'water'), createShopCard('FIRE', 'fire')]);
    expect(cardDamage(cards[0]!)).toBe(18);
    expect(cards[0]!.block).toBe(15);
    expect(cards[0]!.description).toContain('15 shield');
    const battle = createBattle('BOSS', createPlayer(), cards);
    const next = playCard(battle, 'fire');
    expect(cardDamage(cards[1]!, next)).toBe(36);
    expect(cardDamage(upgradeDeck(cards)[0]!)).toBe(22);
  });
});
