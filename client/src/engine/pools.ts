/**
 * 对象池（Object Pool 模式）。
 *
 * 用途：特效粒子这类「每帧高频创建/销毁」的对象，通过复用来消除 GC 抖动（服务 AC-6）。
 *
 * 注意边界：内核（core）里敌人/子弹的增删用的是「写指针原地压缩」——
 * 数组本身已复用，且池化会把对象所有权搞复杂（渲染层还持有引用），
 * 因此在核心里按实测（单步 0.015ms）没有必要引入池；池用在这里真正高频的地方。
 */
export class ObjectPool<T> {
  private readonly free: T[] = [];
  private readonly factory: () => T;
  private readonly limit: number;

  constructor(factory: () => T, limit: number) {
    this.factory = factory;
    this.limit = limit;
  }

  acquire(): T {
    const reused = this.free.pop();
    return reused ?? this.factory();
  }

  release(item: T): void {
    if (this.free.length < this.limit) this.free.push(item);
  }

  /** 回收整批并把数组清空（数组本身保留，供调用方复用）。 */
  releaseAll(items: T[]): void {
    for (let i = 0; i < items.length; i++) this.release(items[i]);
    items.length = 0;
  }

  get available(): number {
    return this.free.length;
  }
}
