"""测试共享构造器（不依赖 fixture，可直接 import）。"""

from __future__ import annotations


def make_save_payload(**overrides) -> dict:
    """一份字段齐全、含小数与非整数毫秒的自动存档快照（用于验证往返精度）。"""
    payload: dict = {
        "level": 3,
        "configVersion": "0123456789abcdef",
        "savedAt": "2026-09-14T00:00:00+00:00",
        "elapsedMs": 12345.5,
        "gold": 137,
        "lives": 18,
        "currentWave": 4,
        "waveState": "ACTIVE",
        "speedMultiplier": 2,
        "paused": False,
        "prepRemainingMs": 0.0,
        "towers": [
            {"col": 3, "row": 9, "towerId": "arrow", "level": 2, "targeting": "FIRST", "cooldownMs": 0.0},
            {"col": 4, "row": 9, "towerId": "frost", "level": 1, "targeting": "CLOSEST", "cooldownMs": 812.5},
        ],
        "spawnProgress": {
            "waveIndex": 3,
            "groups": [{"enemy": "normal", "spawnedCount": 5, "timeSinceLastMs": 233.33333333333334}],
        },
        "enemies": [
            {
                "id": 11,
                "enemyId": "normal",
                "pathDistance": 418.25,
                "hp": 63.5,
                "maxHp": 110.00000000000001,
                "spawnOrder": 11,
                "slowDebuffs": [{"sourceTowerId": 133, "slowFactor": 0.3, "remainingMs": 1500.0}],
            }
        ],
        "projectiles": [
            {
                "id": 7,
                "sourceTowerId": 133,
                "x": 130.5,
                "y": 380.0,
                "targetEnemyId": 11,
                "hitX": None,
                "hitY": None,
                "speed": 600,
                "damage": 25,
                "splashRadius": None,
                "slowFactor": None,
                "slowDuration": None,
            }
        ],
        "nextEnemyId": 12,
        "nextProjectileId": 8,
    }
    payload.update(overrides)
    return payload


def make_record(**overrides) -> dict:
    """一条战绩登记请求体。"""
    body = {
        "result": "victory",
        "waveReached": 10,
        "livesRemaining": 12,
        "elapsedMs": 245000,
        "configVersion": "0123456789abcdef",
    }
    body.update(overrides)
    return body
