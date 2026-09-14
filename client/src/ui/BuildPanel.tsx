/**
 * 建塔面板：列出配置里的全部塔类型，点击选中后到棋盘上落子。
 *
 * 状态齐备：hover / focus-visible / selected(aria-pressed) / disabled(带原因)。
 * 金币不足时按钮置灰并在 title 里说明差多少金币——判定用的 cost 来自后端配置。
 */
import type { ConfigResponse, TowerDef } from '../config/schema';
import { TOWER_ROLE_LABEL } from './labels';

export interface BuildPanelProps {
  config: ConfigResponse;
  gold: number;
  selectedTowerId: string | null;
  /** 暂停冻结 / 终局时禁止建塔。 */
  frozen: boolean;
  frozenReason: string | null;
  onSelect: (towerId: string) => void;
}

function statLine(tower: TowerDef): string {
  const level = tower.levels[0];
  if (!level) return '—';
  const parts = [`伤害 ${level.damage}`, `射程 ${level.range}`];
  if (level.slowFactor !== null) parts.push(`减速 ${Math.round(level.slowFactor * 100)}%`);
  if (level.splashRadius !== null) parts.push(`溅射 ${level.splashRadius}`);
  return parts.join(' · ');
}

export function BuildPanel({
  config,
  gold,
  selectedTowerId,
  frozen,
  frozenReason,
  onSelect,
}: BuildPanelProps): JSX.Element {
  return (
    <div className="td-build">
      <ul className="td-build__list">
        {config.towers.map((tower) => {
          const affordable = gold >= tower.cost;
          const disabled = frozen || !affordable;
          const reason = frozen
            ? (frozenReason ?? '当前不可操作')
            : affordable
              ? null
              : `金币不足：需要 ${tower.cost}，当前 ${gold}`;
          const selected = selectedTowerId === tower.id;

          return (
            <li key={tower.id}>
              <button
                type="button"
                className={['td-tower-card', selected ? 'is-selected' : ''].filter(Boolean).join(' ')}
                aria-pressed={selected}
                aria-describedby={`tower-${tower.id}-stats`}
                disabled={disabled}
                title={reason ?? '选中后在棋盘空格点击建造'}
                onClick={() => onSelect(tower.id)}
              >
                <span className="td-tower-card__head">
                  <span className="td-tower-card__name">{tower.name}</span>
                  <span className="td-tower-card__cost">{tower.cost} 金</span>
                </span>
                <span className="td-tower-card__role">{TOWER_ROLE_LABEL[tower.role]}</span>
                <span className="td-tower-card__stats" id={`tower-${tower.id}-stats`}>
                  {statLine(tower)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="td-hint">
        先选塔，再点棋盘上的空格建造；右键或 Esc 取消选择。快捷键 1 / 2 / 3 对应上面三张卡。
      </p>
    </div>
  );
}
