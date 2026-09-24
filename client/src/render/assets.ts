/**
 * 运行时素材（Kenney "Tower Defense (Top-Down)"，CC0，见 public/td/LICENSE.txt）。
 *
 * 素材异步加载：加载完成前渲染层保持程序化绘制兜底；加载完成后自动切换，
 * 并由 CanvasRenderer 重建静态层（草地/泥路瓷砖）。
 */
export type SpriteKey =
  | 'towerSingle'
  | 'towerSplash'
  | 'towerSlow'
  | 'enemyNormal'
  | 'enemyFast'
  | 'enemyHeavy'
  | 'tileGrass'
  | 'tileRoad'
  | 'tileBlendN'
  | 'tileBlendS'
  | 'tileBlendE'
  | 'tileBlendW'
  | 'tileCornerNE'
  | 'tileCornerSE'
  | 'tileCornerSW'
  | 'tileCornerNW'
  | 'decorTree'
  | 'decorRock';

const MANIFEST: Readonly<Record<SpriteKey, string>> = {
  towerSingle: '/td/tower-single.png',
  towerSplash: '/td/tower-splash.png',
  towerSlow: '/td/tower-slow.png',
  enemyNormal: '/td/enemy-normal.png',
  enemyFast: '/td/enemy-fast.png',
  enemyHeavy: '/td/enemy-heavy.png',
  tileGrass: '/td/tile-grass.png',
  tileRoad: '/td/tile-road.png',
  tileBlendN: '/td/tile-blend-n.png',
  tileBlendS: '/td/tile-blend-s.png',
  tileBlendE: '/td/tile-blend-e.png',
  tileBlendW: '/td/tile-blend-w.png',
  tileCornerNE: '/td/tile-corner-ne.png',
  tileCornerSE: '/td/tile-corner-se.png',
  tileCornerSW: '/td/tile-corner-sw.png',
  tileCornerNW: '/td/tile-corner-nw.png',
  decorTree: '/td/decor-tree.png',
  decorRock: '/td/decor-rock.png',
};

export class SpriteStore {
  private readonly images = new Map<SpriteKey, HTMLImageElement>();
  private readonly listeners: Array<() => void> = [];
  private ready = false;

  get isReady(): boolean {
    return this.ready;
  }

  get(key: SpriteKey): HTMLImageElement | null {
    const image = this.images.get(key);
    if (!image || !image.complete || image.naturalWidth <= 0) return null;
    return image;
  }

  /** 全部素材加载结束（成功或失败）后回调一次；若已就绪则立即回调。 */
  onReady(listener: () => void): void {
    if (this.ready) {
      listener();
      return;
    }
    this.listeners.push(listener);
  }

  load(): void {
    if (this.images.size > 0) return;
    const entries = Object.entries(MANIFEST) as Array<[SpriteKey, string]>;
    let pending = entries.length;
    const settle = (): void => {
      pending -= 1;
      if (pending > 0) return;
      this.ready = true;
      for (const listener of this.listeners) listener();
      this.listeners.length = 0;
    };
    for (const [key, url] of entries) {
      const image = new Image();
      image.onload = settle;
      image.onerror = settle;
      image.src = url;
      this.images.set(key, image);
    }
  }
}
