/**
 * 塔详情面板：等级 / 伤害 / 射程 / 射速 / 升级费 / 出售返还 + 索敌策略切换。
 *
 * 两种状态：
 *  - empty：未选中塔 → 明确提示如何选中，不留白；
 *  - ready：显示实际数值，升级按钮在「已满级」与「金币不足」时置灰并给出原因。
 *
 * 索敌用原生 radio（`<fieldset>/<legend>`）——天然 Tab 可达 + 方向键切换 + 焦点可见。
 */
import type { TargetingMode } from '../config/schema';
import type { SelectedTowerInfo } from '../engine/GameStore';
import { TARGETING_HINT, TARGETING_LABEL, TARGETING_ORDER, TOWER_ROLE_LABEL } from './labels';
import { Button, Tooltip } from './primitives';

export interface TowerDetailProps {
  selected: SelectedTowerInfo | null;
  gold: number;
  frozen: boolean;
  frozenReason: string | null;
  onUpgrade: () => void;
  onSell: () => void;
  onTargeting: (mode: TargetingMode) => void;
}

interface RowProps {
  label: string;
  value: string;
}

function Row({ label, value }: RowProps): JSX.Element {
  return (
    <div className="td-kv">
      <dt className="td-kv__key">{label}</dt>
      <dd className="td-kv__value">{value}</dd>
    </div>
  );
}

export function TowerDetail({
  selected,
  gold,
  frozen,
  frozenReason,
  onUpgrade,
  onSell,
  onTargeting,
}: TowerDetailProps): JSX.Element {
  if (!selected) {
    return (
      <p className="td-empty" data-testid="tower-detail-empty">
        点击棋盘上已建成的塔，可查看等级与数值，并进行升级或出售。
      </p>
    );
  }

  const maxed = selected.level >= selected.maxLevel;
  const upgradeCost = selected.upgradeCost;
  const canAffordUpgrade = upgradeCost !== null && gold >= upgradeCost;
  const upgradeDisabled = frozen || maxed || !canAffordUpgrade;
  const upgradeReason = frozen
    ? (frozenReason ?? '当前不可操作')
    : maxed
      ? '已达最高等级'
      : upgradeCost === null
        ? '无可用升级'
        : canAffordUpgrade
          ? null
          : `金币不足：需要 ${upgradeCost}，当前 ${gold}`;

  return (
    <div className="td-detail">
      <div className="td-detail__head">
        <span className="td-detail__name">{selected.name}</span>
        <span className="td-detail__role">{TOWER_ROLE_LABEL[selected.role]}</span>
        <span className="td-detail__level">
          Lv {selected.level} / {selected.maxLevel}
        </span>
      </div>

      <dl className="td-kv-list">
        <Row label="伤害" value={String(selected.damage)} />
        <Row label="射程" value={`${selected.range} px`} />
        <Row label="射速" value={`每秒 ${selected.fireRate} 次`} />
        <Row label="位置" value={`第 ${selected.col + 1} 列 / 第 ${selected.row + 1} 行`} />
      </dl>

      <div className="td-detail__actions">
        <Button
          variant="filled"
          block
          disabled={upgradeDisabled}
          disabledReason={upgradeReason}
          onClick={onUpgrade}
        >
          {maxed ? '已满级' : `升级（${upgradeCost ?? 0} 金）`}
        </Button>
        <Button
          variant="outlined"
          block
          disabled={frozen}
          disabledReason={frozenReason ?? '当前不可操作'}
          onClick={onSell}
        >
          出售（返还 {selected.sellRefund} 金）
        </Button>
      </div>

      <fieldset className="td-fieldset">
        <legend className="td-fieldset__legend">索敌策略</legend>
        <div className="td-radio-grid">
          {TARGETING_ORDER.map((mode) => (
            <Tooltip key={mode} text={TARGETING_HINT[mode]} className="td-radio-cell">
              <label className="td-radio">
                <input
                  type="radio"
                  name={`targeting-${selected.col}-${selected.row}`}
                  value={mode}
                  checked={selected.targeting === mode}
                  onChange={() => onTargeting(mode)}
                />
                <span>{TARGETING_LABEL[mode]}</span>
              </label>
            </Tooltip>
          ))}
        </div>
        <p className="td-hint">快捷键 Q / W / E / R 依次切换四种策略。</p>
      </fieldset>
    </div>
  );
}
