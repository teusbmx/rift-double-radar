"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

/* ============================================================
   RIFT DOUBLE RADAR V4.1.3 ADAPTIVE
   ------------------------------------------------------------
   CONFIGURAÇÃO:
   - Backtest mínimo: 1%
   - Backtest recente mínimo: 1%
   - Piso adaptativo histórico: 1%
   - Piso adaptativo recente: 1%
   - Correção TDZ uniqueWarnings / uniqueBlockers / sinal
   ============================================================ */

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const VERSION = "RIFT Double Radar V4.1.3 ADAPTIVE";

/* ============================================================
   FONTE
============================================================ */

const TIPMINER_URL =
  "https://api.core.public.tipminer.com/v1/double/rounds/6ee2f33f-7dbf-40ae-b01c-b05368c806ba/history?limit=200&timezone=UTC";

const BLAZE_URLS = [
  "https://blaze.bet.br/api/roulette_games/recent",
  "https://blaze.com/api/roulette_games/recent"
];

/* ============================================================
   CONFIGURAÇÃO
============================================================ */

const CONFIG = {
  MIN_HISTORY_SIGNAL: 30,

  MIN_ACTIVE_STRATEGIES: 4,

  MIN_VOTES: 3,

  MIN_CONSENSUS_PCT: 55,

  MIN_VOTE_PCT: 50,

  MIN_MARGIN_PCT: 8,

  MIN_STABILITY_PCT: 50,

  MIN_QUALITY: 55,

  /*
   * ==========================================================
   * BACKTEST NORMAL
   * ==========================================================
   */

  MIN_BACKTEST_RATE: 1,

  MIN_RECENT_RATE: 1,

  /*
   * ==========================================================
   * BACKTEST ADAPTATIVO
   * ==========================================================
   */

  STRONG_SIGNAL_CONSENSUS: 75,

  STRONG_SIGNAL_VOTE_PCT: 65,

  STRONG_SIGNAL_MARGIN: 20,

  STRONG_SIGNAL_STABILITY: 75,

  STRONG_SIGNAL_QUALITY: 70,

  STRONG_SIGNAL_MIN_VOTES: 5,

  STRONG_SIGNAL_MIN_BACKTEST: 1,

  STRONG_SIGNAL_MIN_RECENT: 1,

  /*
   * Janelas
   */

  RECENT_WINDOW: 60,

  LONG_WINDOW: 180,

  /*
   * Suavização estatística
   */

  PRIOR_RATE: 50,

  PRIOR_STRENGTH: 12,

  MIN_TESTS_FOR_FULL_WEIGHT: 12,

  MIN_TESTS_RANKING: 5,

  MAX_WEIGHT_FACTOR: 1.45,

  MIN_WEIGHT_FACTOR: 0.45,

  WHITE_MAX_WEIGHT: 0.90,

  AI_MAX_CONF_BONUS: 3
};

/* ============================================================
   IA
============================================================ */

const GROQ_DEFAULT_MODEL =
  "openai/gpt-oss-20b";

const GROQ_MODELS = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b"
];

const OLD_MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.1-8b-instant-preview",
  "llama-3.3-70b-versatile"
];

function loadConfig() {
  let cfg = {};

  try {
    const file =
      path.join(
        ROOT,
        "config.json"
      );

    if (fs.existsSync(file)) {
      cfg =
        JSON.parse(
          fs.readFileSync(
            file,
            "utf8"
          )
        ) || {};
    }
  } catch (err) {
    console.log(
      "[config] erro:",
      err.message
    );
  }

  let groqModel =
    process.env.GROQ_MODEL ||
    cfg.GROQ_MODEL ||
    cfg.groqModel ||
    GROQ_DEFAULT_MODEL;

  if (
    !groqModel ||
    OLD_MODELS.includes(
      groqModel
    )
  ) {
    groqModel =
      GROQ_DEFAULT_MODEL;
  }

  return {
    provider:
      String(
        process.env.AI_PROVIDER ||
        cfg.AI_PROVIDER ||
        "auto"
      ).toLowerCase(),

    groqKey:
      process.env.GROQ_API_KEY ||
      cfg.GROQ_API_KEY ||
      cfg.groqApiKey ||
      "",

    groqModel,

    xaiKey:
      process.env.XAI_API_KEY ||
      cfg.XAI_API_KEY ||
      "",

    xaiModel:
      process.env.XAI_MODEL ||
      cfg.XAI_MODEL ||
      "grok-3-mini"
  };
}

const CFG = loadConfig();

/* ============================================================
   CONTROLE IA
============================================================ */

const MODEL_COOLDOWN =
  new Map();

function activeAI() {
  if (
    CFG.provider === "xai" &&
    CFG.xaiKey
  ) {
    return {
      name: "xai",
      key: CFG.xaiKey,
      model: CFG.xaiModel,
      base: "https://api.x.ai/v1"
    };
  }

  if (CFG.groqKey) {
    return {
      name: "groq",
      key: CFG.groqKey,
      model: CFG.groqModel,
      base:
        "https://api.groq.com/openai/v1"
    };
  }

  if (CFG.xaiKey) {
    return {
      name: "xai",
      key: CFG.xaiKey,
      model: CFG.xaiModel,
      base: "https://api.x.ai/v1"
    };
  }

  return null;
}

function isCooling(model) {
  return (
    Date.now() <
    (
      MODEL_COOLDOWN.get(
        model
      ) || 0
    )
  );
}

function setCooldown(
  model,
  ms
) {
  MODEL_COOLDOWN.set(
    model,
    Date.now() + ms
  );
}

/* ============================================================
   HTTP
============================================================ */

function fetchUrl(
  target,
  timeout = 10000
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      let u;

      try {
        u =
          new URL(target);
      } catch (_) {
        reject(
          new Error(
            "URL inválida"
          )
        );

        return;
      }

      const lib =
        u.protocol === "https:"
          ? https
          : http;

      const req =
        lib.request(
          {
            hostname:
              u.hostname,

            port:
              u.port ||
              undefined,

            path:
              u.pathname +
              u.search,

            method:
              "GET",

            timeout,

            headers: {
              Accept:
                "application/json",

              "User-Agent":
                "Mozilla/5.0 RIFT-Double-Radar"
            }
          },

          res => {
            let body = "";

            res.setEncoding(
              "utf8"
            );

            res.on(
              "data",
              chunk => {
                body += chunk;
              }
            );

            res.on(
              "end",
              () => {
                if (
                  res.statusCode >=
                    200 &&
                  res.statusCode <
                    300
                ) {
                  resolve({
                    status:
                      res.statusCode,

                    body
                  });
                } else {
                  const err =
                    new Error(
                      `HTTP ${res.statusCode}: ${body.slice(
                        0,
                        500
                      )}`
                    );

                  err.statusCode =
                    res.statusCode;

                  reject(err);
                }
              }
            );
          }
        );

      req.on(
        "error",
        reject
      );

      req.on(
        "timeout",
        () => {
          req.destroy();

          reject(
            new Error(
              "Timeout"
            )
          );
        }
      );

      req.end();
    }
  );
}

function postJson(
  target,
  body,
  headers = {},
  timeout = 30000
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      let u;

      try {
        u =
          new URL(target);
      } catch (_) {
        reject(
          new Error(
            "URL inválida"
          )
        );

        return;
      }

      const data =
        JSON.stringify(body);

      const lib =
        u.protocol === "https:"
          ? https
          : http;

      const req =
        lib.request(
          {
            hostname:
              u.hostname,

            port:
              u.port ||
              undefined,

            path:
              u.pathname +
              u.search,

            method:
              "POST",

            timeout,

            headers: {
              "Content-Type":
                "application/json",

              "Content-Length":
                Buffer.byteLength(
                  data
                ),

              ...headers
            }
          },

          res => {
            let response = "";

            res.setEncoding(
              "utf8"
            );

            res.on(
              "data",
              chunk => {
                response +=
                  chunk;
              }
            );

            res.on(
              "end",
              () => {
                if (
                  res.statusCode >=
                    200 &&
                  res.statusCode <
                    300
                ) {
                  resolve({
                    status:
                      res.statusCode,

                    body:
                      response
                  });
                } else {
                  const err =
                    new Error(
                      `HTTP ${res.statusCode}: ${response.slice(
                        0,
                        700
                      )}`
                    );

                  err.statusCode =
                    res.statusCode;

                  reject(err);
                }
              }
            );
          }
        );

      req.on(
        "error",
        reject
      );

      req.on(
        "timeout",
        () => {
          req.destroy();

          reject(
            new Error(
              "Timeout"
            )
          );
        }
      );

      req.write(data);

      req.end();
    }
  );
}

/* ============================================================
   NORMALIZAÇÃO
============================================================ */

function normalizeColor(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const s =
    String(value)
      .trim()
      .toUpperCase();

  if (
    s === "V" ||
    s === "RED" ||
    s === "VERMELHO" ||
    s === "1"
  ) {
    return "V";
  }

  if (
    s === "P" ||
    s === "BLACK" ||
    s === "PRETO" ||
    s === "2"
  ) {
    return "P";
  }

  if (
    s === "B" ||
    s === "WHITE" ||
    s === "BRANCO" ||
    s === "0"
  ) {
    return "B";
  }

  const n =
    Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  if (n === 0) {
    return "B";
  }

  if (
    n >= 1 &&
    n <= 7
  ) {
    return "V";
  }

  if (
    n >= 8 &&
    n <= 14
  ) {
    return "P";
  }

  return null;
}

function normalizeItems(
  arr,
  source
) {
  if (
    !Array.isArray(arr)
  ) {
    return [];
  }

  return arr
    .map(item => {
      const rawRoll =
        item?.roll ??
        item?.result ??
        item?.number ??
        item?.value;

      const roll =
        Number(rawRoll);

      let color =
        normalizeColor(
          item?.color
        );

      if (!color) {
        color =
          normalizeColor(
            rawRoll
          );
      }

      if (!color) {
        return null;
      }

      return {
        roll:
          Number.isFinite(
            roll
          )
            ? roll
            : null,

        color,

        id:
          item?.id ??
          item?.uuid ??
          item?.round_id ??
          null,

        instant:
          item?.instant ??
          item?.created_at ??
          item?.createdAt ??
          item?.updated_at ??
          null,

        source
      };
    })
    .filter(Boolean);
}

/* ============================================================
   HISTÓRICO
============================================================ */

let historyCache = {
  data: null,
  time: 0
};

async function getHistory(
  force = false
) {
  if (
    !force &&
    historyCache.data &&
    Date.now() -
      historyCache.time <
      1500
  ) {
    return historyCache.data;
  }

  try {
    const r =
      await fetchUrl(
        TIPMINER_URL
      );

    const json =
      JSON.parse(
        r.body
      );

    const arr =
      Array.isArray(json)
        ? json
        : json?.data ||
          json?.rounds ||
          json?.results ||
          [];

    const items =
      normalizeItems(
        arr,
        "tipminer"
      );

    if (items.length) {
      historyCache = {
        data: {
          source:
            "tipminer",

          items
        },

        time:
          Date.now()
      };

      return historyCache.data;
    }
  } catch (err) {
    console.log(
      "[history] tipminer:",
      err.message
    );
  }

  for (
    const url of BLAZE_URLS
  ) {
    try {
      const r =
        await fetchUrl(
          url
        );

      const json =
        JSON.parse(
          r.body
        );

      const arr =
        Array.isArray(json)
          ? json
          : json?.data ||
            json?.rounds ||
            [];

      const items =
        normalizeItems(
          arr,
          "blaze"
        );

      if (items.length) {
        historyCache = {
          data: {
            source:
              "blaze",

            items
          },

          time:
            Date.now()
        };

        return historyCache.data;
      }
    } catch (err) {
      console.log(
        "[history] blaze:",
        err.message
      );
    }
  }

  throw new Error(
    "Não foi possível obter o histórico."
  );
}

/* ============================================================
   ORDENAÇÃO
============================================================ */

function itemTime(item) {
  if (!item) {
    return NaN;
  }

  const t =
    item.instant
      ? new Date(
          item.instant
        ).getTime()
      : NaN;

  return Number.isFinite(t)
    ? t
    : NaN;
}

function sortRoundsAscending(
  items
) {
  if (
    !Array.isArray(items)
  ) {
    return [];
  }

  const validTimes =
    items.filter(
      x =>
        Number.isFinite(
          itemTime(x)
        )
    );

  if (
    validTimes.length >= 2
  ) {
    return [
      ...items
    ].sort(
      (a, b) => {
        const ta =
          itemTime(a);

        const tb =
          itemTime(b);

        if (
          Number.isFinite(
            ta
          ) &&
          Number.isFinite(
            tb
          )
        ) {
          return ta - tb;
        }

        return 0;
      }
    );
  }

  return [
    ...items
  ];
}

function getLatestRound(
  items
) {
  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    return null;
  }

  const sorted =
    sortRoundsAscending(
      items
    );

  return (
    sorted[
      sorted.length - 1
    ] || null
  );
}

/* ============================================================
   UTILITÁRIOS
============================================================ */

function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}

function round1(
  value
) {
  return (
    Math.round(
      Number(
        value || 0
      ) * 10
    ) / 10
  );
}

function round3(
  value
) {
  return (
    Math.round(
      Number(
        value || 0
      ) * 1000
    ) / 1000
  );
}

function pct(
  value,
  total
) {
  if (
    !Number.isFinite(
      Number(value)
    ) ||
    !Number.isFinite(
      Number(total)
    ) ||
    Number(total) <= 0
  ) {
    return 0;
  }

  return round1(
    (
      Number(value) /
      Number(total)
    ) * 100
  );
}

function counts(
  colors
) {
  return {
    V:
      colors.filter(
        x => x === "V"
      ).length,

    P:
      colors.filter(
        x => x === "P"
      ).length,

    B:
      colors.filter(
        x => x === "B"
      ).length
  };
}

function density(
  colors
) {
  const c =
    counts(colors);

  return {
    V:
      pct(
        c.V,
        colors.length
      ),

    P:
      pct(
        c.P,
        colors.length
      ),

    B:
      pct(
        c.B,
        colors.length
      ),

    n:
      colors.length
  };
}

function getStreak(
  colors
) {
  if (!colors.length) {
    return {
      color: null,
      length: 0
    };
  }

  const color =
    colors[
      colors.length - 1
    ];

  let length = 1;

  for (
    let i =
      colors.length - 2;
    i >= 0;
    i--
  ) {
    if (
      colors[i] === color
    ) {
      length++;
    } else {
      break;
    }
  }

  return {
    color,
    length
  };
}

function getWhiteGap(
  colors
) {
  let gap = 0;

  for (
    let i =
      colors.length - 1;
    i >= 0;
    i--
  ) {
    if (
      colors[i] === "B"
    ) {
      return gap;
    }

    gap++;
  }

  return gap;
}

function alternation(
  colors
) {
  let total = 0;

  for (
    let i = 1;
    i < colors.length;
    i++
  ) {
    if (
      colors[i] !== "B" &&
      colors[i - 1] !== "B" &&
      colors[i] !==
        colors[i - 1]
    ) {
      total++;
    }
  }

  return total;
}

/* ============================================================
   ESTRATÉGIAS
============================================================ */

function markov(
  colors
) {
  if (
    colors.length < 5
  ) {
    return {
      entrada: null,
      score: 0
    };
  }

  const last =
    colors[
      colors.length - 1
    ];

  const c = {
    V: 0,
    P: 0,
    B: 0
  };

  let total = 0;

  for (
    let i = 0;
    i < colors.length - 1;
    i++
  ) {
    if (
      colors[i] === last
    ) {
      const next =
        colors[i + 1];

      if (
        c[next] !==
        undefined
      ) {
        c[next]++;
        total++;
      }
    }
  }

  if (!total) {
    return {
      entrada: null,
      score: 0
    };
  }

  const sorted =
    Object.entries(c)
      .sort(
        (a, b) =>
          b[1] - a[1]
      );

  return {
    entrada:
      sorted[0][0],

    score:
      pct(
        sorted[0][1],
        total
      ),

    dados:
      c,

    amostra:
      total
  };
}

function densityStrategy(
  colors
) {
  const recent =
    colors.slice(-12);

  const d =
    density(recent);

  let entrada =
    d.V <= d.P
      ? "V"
      : "P";

  if (
    d.B >= 15
  ) {
    entrada =
      d.V >= d.P
        ? "P"
        : "V";
  }

  return {
    entrada,

    score:
      clamp(
        50 +
          Math.abs(
            d.V - d.P
          ),
        50,
        90
      ),

    dados:
      d
  };
}

function streakStrategy(
  colors
) {
  const s =
    getStreak(colors);

  if (
    s.length < 2 ||
    ![
      "V",
      "P"
    ].includes(
      s.color
    )
  ) {
    return {
      entrada: null,
      score: 0
    };
  }

  return {
    entrada:
      s.color === "V"
        ? "P"
        : "V",

    score:
      Math.min(
        90,
        52 +
          s.length * 6
      ),

    dados:
      s
  };
}

function alternationStrategy(
  colors
) {
  const recent =
    colors.slice(-10);

  const a =
    alternation(
      recent
    );

  const last =
    recent[
      recent.length - 1
    ];

  if (
    a < 5 ||
    ![
      "V",
      "P"
    ].includes(
      last
    )
  ) {
    return {
      entrada: null,
      score: 0
    };
  }

  return {
    entrada:
      last === "V"
        ? "P"
        : "V",

    score:
      Math.min(
        90,
        50 + a * 5
      ),

    dados: {
      alternacoes:
        a
    }
  };
}

function whiteStrategy(
  colors
) {
  const gap =
    getWhiteGap(
      colors
    );

  if (
    gap < 20
  ) {
    return {
      entrada: null,
      score: 0,

      dados: {
        gap
      }
    };
  }

  return {
    entrada:
      "B",

    score:
      Math.min(
        90,
        50 +
          Math.floor(
            gap / 4
          )
      ),

    dados: {
      gap
    }
  };
}

function frequencyStrategy(
  colors
) {
  const recent =
    colors.slice(-20);

  const d =
    density(recent);

  if (
    d.V === d.P
  ) {
    return {
      entrada: null,
      score: 0
    };
  }

  return {
    entrada:
      d.V > d.P
        ? "P"
        : "V",

    score:
      Math.min(
        82,
        50 +
          Math.abs(
            d.V - d.P
          ) * 0.8
      ),

    dados:
      d
  };
}

function windowStrategy(
  colors,
  size
) {
  const recent =
    colors.slice(-size);

  if (
    recent.length <
    Math.min(
      5,
      size
    )
  ) {
    return {
      entrada: null,
      score: 0
    };
  }

  const d =
    density(recent);

  if (
    d.V === d.P
  ) {
    return {
      entrada: null,
      score: 0
    };
  }

  return {
    entrada:
      d.V < d.P
        ? "V"
        : "P",

    score:
      Math.min(
        85,
        50 +
          Math.abs(
            d.V - d.P
          )
      ),

    dados:
      d
  };
}

function repeatPatternStrategy(
  colors
) {
  if (
    colors.length < 6
  ) {
    return {
      entrada: null,
      score: 0
    };
  }

  const last3 =
    colors.slice(-3);

  const prev3 =
    colors.slice(
      -6,
      -3
    );

  if (
    last3.length !== 3 ||
    prev3.length !== 3
  ) {
    return {
      entrada: null,
      score: 0
    };
  }

  if (
    last3.join("") ===
    prev3.join("")
  ) {
    const last =
      last3[2];

    if (
      [
        "V",
        "P"
      ].includes(
        last
      )
    ) {
      return {
        entrada:
          last === "V"
            ? "P"
            : "V",

        score:
          65,

        dados: {
          padrao:
            last3.join("")
        }
      };
    }
  }

  return {
    entrada: null,
    score: 0
  };
}

function transitionStrategy(
  colors
) {
  if (
    colors.length < 8
  ) {
    return {
      entrada: null,
      score: 0
    };
  }

  const recent =
    colors.slice(-30);

  const transitions = {
    V: {
      V: 0,
      P: 0,
      B: 0
    },

    P: {
      V: 0,
      P: 0,
      B: 0
    },

    B: {
      V: 0,
      P: 0,
      B: 0
    }
  };

  for (
    let i = 0;
    i <
    recent.length - 1;
    i++
  ) {
    const a =
      recent[i];

    const b =
      recent[i + 1];

    if (
      transitions[a] &&
      transitions[a][b] !==
        undefined
    ) {
      transitions[a][b]++;
    }
  }

  const last =
    recent[
      recent.length - 1
    ];

  const row =
    transitions[last];

  if (!row) {
    return {
      entrada: null,
      score: 0
    };
  }

  const entries =
    Object.entries(
      row
    ).sort(
      (a, b) =>
        b[1] - a[1]
    );

  const total =
    entries.reduce(
      (
        sum,
        x
      ) =>
        sum + x[1],
      0
    );

  if (!total) {
    return {
      entrada: null,
      score: 0
    };
  }

  return {
    entrada:
      entries[0][0],

    score:
      Math.min(
        88,
        pct(
          entries[0][1],
          total
        )
      ),

    dados:
      transitions
  };
}

function pressureStrategy(
  colors
) {
  const recent =
    colors.slice(-15);

  const d =
    density(recent);

  if (
    d.V >= 65 &&
    d.P <= 35
  ) {
    return {
      entrada: "P",
      score: 72,
      dados: d
    };
  }

  if (
    d.P >= 65 &&
    d.V <= 35
  ) {
    return {
      entrada: "V",
      score: 72,
      dados: d
    };
  }

  return {
    entrada: null,
    score: 0
  };
}

function lastPairStrategy(
  colors
) {
  const recent =
    colors
      .filter(
        x =>
          x === "V" ||
          x === "P"
      )
      .slice(-2);

  if (
    recent.length < 2
  ) {
    return {
      entrada: null,
      score: 0
    };
  }

  if (
    recent[0] ===
    recent[1]
  ) {
    return {
      entrada:
        recent[1] === "V"
          ? "P"
          : "V",

      score:
        61
    };
  }

  return {
    entrada:
      recent[1],

    score:
      60
  };
}

function balanceStrategy(
  colors
) {
  const recent =
    colors
      .filter(
        x =>
          x === "V" ||
          x === "P"
      )
      .slice(-30);

  if (
    recent.length < 10
  ) {
    return {
      entrada: null,
      score: 0
    };
  }

  const v =
    recent.filter(
      x => x === "V"
    ).length;

  const p =
    recent.filter(
      x => x === "P"
    ).length;

  if (
    v === p
  ) {
    return {
      entrada: null,
      score: 0
    };
  }

  return {
    entrada:
      v > p
        ? "P"
        : "V",

    score:
      Math.min(
        78,
        50 +
          Math.abs(
            v - p
          ) * 2
      ),

    dados: {
      V: v,
      P: p
    }
  };
}

/* ============================================================
   REGISTRY
============================================================ */

const STRATEGY_LABELS = {
  markov:
    "Markov",

  density:
    "Densidade",

  streak:
    "Streak",

  alternation:
    "Alternância",

  white:
    "Branco",

  frequency:
    "Frequência",

  window5:
    "Janela 5",

  window10:
    "Janela 10",

  window20:
    "Janela 20",

  repeat:
    "Repetição",

  transition:
    "Transição",

  pressure:
    "Pressão",

  lastPair:
    "Último Par",

  balance:
    "Balanço"
};

const BASE_WEIGHTS = {
  markov: 1.25,
  density: 1.00,
  streak: 0.90,
  alternation: 0.90,
  white: 0.55,
  frequency: 1.00,
  window5: 0.90,
  window10: 1.00,
  window20: 1.00,
  repeat: 0.80,
  transition: 1.15,
  pressure: 1.00,
  lastPair: 0.75,
  balance: 0.80
};

function getStrategies(
  colors
) {
  return {
    markov:
      markov(colors),

    density:
      densityStrategy(
        colors
      ),

    streak:
      streakStrategy(
        colors
      ),

    alternation:
      alternationStrategy(
        colors
      ),

    white:
      whiteStrategy(
        colors
      ),

    frequency:
      frequencyStrategy(
        colors
      ),

    window5:
      windowStrategy(
        colors,
        5
      ),

    window10:
      windowStrategy(
        colors,
        10
      ),

    window20:
      windowStrategy(
        colors,
        20
      ),

    repeat:
      repeatPatternStrategy(
        colors
      ),

    transition:
      transitionStrategy(
        colors
      ),

    pressure:
      pressureStrategy(
        colors
      ),

    lastPair:
      lastPairStrategy(
        colors
      ),

    balance:
      balanceStrategy(
        colors
      )
  };
}

/* ============================================================
   ESTATÍSTICAS
============================================================ */

function emptyStats(
  name
) {
  return {
    estrategia:
      name,

    nome:
      STRATEGY_LABELS[name] ||
      name,

    testes: 0,
    acertos: 0,
    erros: 0,
    taxa: 0,

    testesRecentes: 0,
    acertosRecentes: 0,
    recenteTaxa: 0,

    taxaAjustada: 50,
    confiabilidade: 0,
    peso: 0,
    fator: 1
  };
}

function smoothedRate(
  wins,
  tests,
  priorRate =
    CONFIG.PRIOR_RATE,
  priorStrength =
    CONFIG.PRIOR_STRENGTH
) {
  return (
    (
      Number(wins || 0) +
      priorRate *
        priorStrength
    ) /
    (
      Number(tests || 0) +
      priorStrength
    )
  );
}

/* ============================================================
   BACKTEST
============================================================ */

function backtest(
  colors
) {
  const names =
    Object.keys(
      STRATEGY_LABELS
    );

  const stats = {};

  for (
    const name of names
  ) {
    stats[name] =
      emptyStats(name);
  }

  if (
    colors.length < 30
  ) {
    return {
      stats,
      ranking: [],
      melhor: null,
      amostra: 0,
      janela: 0,
      adaptive: true,
      taxa: 0,
      recentRate: 0,
      acertos: 0,
      erros: 0,
      testes: 0
    };
  }

  const end =
    colors.length;

  const start =
    Math.max(
      25,
      end -
        CONFIG.LONG_WINDOW
    );

  for (
    let i = start;
    i < end;
    i++
  ) {
    const history =
      colors.slice(
        0,
        i
      );

    const actual =
      colors[i];

    const strategies =
      getStrategies(
        history
      );

    for (
      const name of names
    ) {
      const prediction =
        strategies[name]
          ?.entrada;

      if (!prediction) {
        continue;
      }

      const s =
        stats[name];

      s.testes++;

      if (
        prediction ===
        actual
      ) {
        s.acertos++;
      } else {
        s.erros++;
      }
    }
  }

  const recentStart =
    Math.max(
      start,
      end -
        CONFIG.RECENT_WINDOW
    );

  for (
    let i = recentStart;
    i < end;
    i++
  ) {
    const history =
      colors.slice(
        0,
        i
      );

    const actual =
      colors[i];

    const strategies =
      getStrategies(
        history
      );

    for (
      const name of names
    ) {
      const prediction =
        strategies[name]
          ?.entrada;

      if (!prediction) {
        continue;
      }

      const s =
        stats[name];

      s.testesRecentes++;

      if (
        prediction ===
        actual
      ) {
        s.acertosRecentes++;
      }
    }
  }

  let totalTests = 0;
  let totalWins = 0;

  let recentTests = 0;
  let recentWins = 0;

  for (
    const s of Object.values(
      stats
    )
  ) {
    s.taxa =
      s.testes > 0
        ? round1(
            (
              s.acertos /
              s.testes
            ) * 100
          )
        : 0;

    s.recenteTaxa =
      s.testesRecentes > 0
        ? round1(
            (
              s.acertosRecentes /
              s.testesRecentes
            ) * 100
          )
        : s.taxa;

    s.taxaAjustada =
      round1(
        smoothedRate(
          s.acertos,
          s.testes
        )
      );

    const recentAdjusted =
      s.testesRecentes > 0
        ? smoothedRate(
            s.acertosRecentes,
            s.testesRecentes
          )
        : s.taxaAjustada;

    const recentInfluence =
      clamp(
        s.testesRecentes /
          30,
        0,
        1
      );

    const adjusted =
      s.taxaAjustada *
        (
          1 -
          0.35 *
          recentInfluence
        ) +
      recentAdjusted *
        (
          0.35 *
          recentInfluence
        );

    s.confiabilidade =
      round1(
        clamp(
          adjusted,
          0,
          100
        )
      );

    const evidence =
      clamp(
        s.testes /
          CONFIG.MIN_TESTS_FOR_FULL_WEIGHT,
        0,
        1
      );

    const performanceDelta =
      (
        s.confiabilidade -
        50
      ) / 50;

    let factor =
      1 +
      performanceDelta *
        0.55 *
        evidence;

    factor =
      clamp(
        factor,
        CONFIG.MIN_WEIGHT_FACTOR,
        CONFIG.MAX_WEIGHT_FACTOR
      );

    s.fator =
      round3(
        factor
      );

    s.peso =
      round3(
        factor
      );

    totalTests +=
      s.testes;

    totalWins +=
      s.acertos;

    recentTests +=
      s.testesRecentes;

    recentWins +=
      s.acertosRecentes;
  }

  const ranking =
    Object.values(
      stats
    )
      .filter(
        s =>
          s.testes >=
          CONFIG.MIN_TESTS_RANKING
      )
      .sort(
        (a, b) =>
          b.confiabilidade -
          a.confiabilidade
      );

  const taxa =
    totalTests > 0
      ? round1(
          (
            totalWins /
            totalTests
          ) * 100
        )
      : 0;

  const recentRate =
    recentTests > 0
      ? round1(
          (
            recentWins /
            recentTests
          ) * 100
        )
      : taxa;

  return {
    stats,

    ranking,

    melhor:
      ranking[0] ||
      null,

    amostra:
      end - start,

    janela:
      end - start,

    adaptive: true,

    taxa,

    recentRate,

    acertos:
      totalWins,

    erros:
      totalTests -
      totalWins,

    testes:
      totalTests
  };
}

/* ============================================================
   REGIME
============================================================ */

function getRegime(
  colors
) {
  const d10 =
    density(
      colors.slice(-10)
    );

  const d20 =
    density(
      colors.slice(-20)
    );

  const streak =
    getStreak(
      colors
    );

  const gap =
    getWhiteGap(
      colors
    );

  const alt =
    alternation(
      colors.slice(-10)
    );

  let regime =
    "NEUTRO";

  let score = 50;

  let reason =
    "Histórico sem padrão dominante.";

  if (
    streak.length >= 4 &&
    [
      "V",
      "P"
    ].includes(
      streak.color
    )
  ) {
    regime =
      "STREAK";

    score =
      Math.min(
        95,
        60 +
          streak.length * 5
      );

    reason =
      `Sequência ${streak.color} x${streak.length}.`;
  } else if (
    d10.V >= 60 &&
    d20.V >= 55
  ) {
    regime =
      "PRESSAO_V";

    score =
      Math.round(
        d10.V
      );

    reason =
      "Pressão recente de vermelho.";
  } else if (
    d10.P >= 60 &&
    d20.P >= 55
  ) {
    regime =
      "PRESSAO_P";

    score =
      Math.round(
        d10.P
      );

    reason =
      "Pressão recente de preto.";
  } else if (
    alt >= 6
  ) {
    regime =
      "ALTERNANCIA";

    score =
      Math.min(
        90,
        55 +
          alt * 5
      );

    reason =
      "Alternância elevada.";
  } else if (
    gap >= 30
  ) {
    regime =
      "GAP_BRANCO";

    score =
      Math.min(
        90,
        55 +
          Math.floor(
            gap / 5
          )
      );

    reason =
      `Branco ausente há ${gap} rodadas.`;
  }

  return {
    regime,
    score,
    reason,
    streak,
    gapBranco:
      gap,
    alternancia:
      alt,
    density10:
      d10,
    density20:
      d20
  };
}

/* ============================================================
   MULTIPLICADOR
============================================================ */

function regimeMultiplier(
  name,
  regime
) {
  const multipliers = {
    STREAK: {
      streak: 1.15,
      lastPair: 1.06,
      markov: 1.06,
      alternation: 0.82
    },

    PRESSAO_V: {
      pressure: 1.12,
      frequency: 1.08,
      density: 1.04,
      balance: 1.04,
      alternation: 0.90
    },

    PRESSAO_P: {
      pressure: 1.12,
      frequency: 1.08,
      density: 1.04,
      balance: 1.04,
      alternation: 0.90
    },

    ALTERNANCIA: {
      alternation: 1.18,
      lastPair: 1.08,
      markov: 1.04,
      streak: 0.78,
      pressure: 0.88
    },

    GAP_BRANCO: {
      white: 1.08
    },

    NEUTRO: {}
  };

  return (
    multipliers[
      regime
    ]?.[name] ||
    1
  );
}

/* ============================================================
   PESOS
============================================================ */

function adaptiveWeight(
  name,
  bt,
  regime
) {
  const base =
    Number(
      BASE_WEIGHTS[name]
    ) || 1;

  const stat =
    bt?.stats?.[name];

  const performanceFactor =
    Number(
      stat?.fator
    ) || 1;

  const regimeFactor =
    regime
      ? regimeMultiplier(
          name,
          regime.regime
        )
      : 1;

  const cappedRegime =
    clamp(
      regimeFactor,
      0.75,
      1.20
    );

  let weight =
    base *
    performanceFactor *
    cappedRegime;

  if (
    name === "white"
  ) {
    weight =
      Math.min(
        weight,
        CONFIG.WHITE_MAX_WEIGHT
      );
  }

  return weight;
}

/* ============================================================
   CONSENSO
============================================================ */

function calculateConsensus(
  colors,
  bt = null,
  regime = null
) {
  const strategies =
    getStrategies(
      colors
    );

  const votes = {
    V: 0,
    P: 0,
    B: 0
  };

  const weighted = {
    V: 0,
    P: 0,
    B: 0
  };

  const active = [];
  const details = {};

  for (
    const [
      name,
      result
    ] of Object.entries(
      strategies
    )
  ) {
    if (
      !result ||
      !result.entrada
    ) {
      continue;
    }

    if (
      votes[
        result.entrada
      ] === undefined
    ) {
      continue;
    }

    const rawScore =
      Number(
        result.score
      );

    if (
      !Number.isFinite(
        rawScore
      ) ||
      rawScore <= 0
    ) {
      continue;
    }

    const baseWeight =
      Number(
        BASE_WEIGHTS[name]
      ) || 1;

    const finalWeight =
      adaptiveWeight(
        name,
        bt,
        regime
      );

    const contribution =
      rawScore *
      finalWeight;

    votes[
      result.entrada
    ]++;

    weighted[
      result.entrada
    ] +=
      contribution;

    active.push(
      name
    );

    const stat =
      bt?.stats?.[name];

    details[name] = {
      id:
        name,

      nome:
        STRATEGY_LABELS[
          name
        ] || name,

      entrada:
        result.entrada,

      score:
        rawScore,

      baseWeight:
        round3(
          baseWeight
        ),

      adaptiveFactor:
        round3(
          stat?.fator ||
          1
        ),

      historicalRate:
        round1(
          stat?.taxa ||
          0
        ),

      recentRate:
        round1(
          stat?.recenteTaxa ||
          0
        ),

      tests:
        Number(
          stat?.testes
        ) || 0,

      recentTests:
        Number(
          stat?.testesRecentes
        ) || 0,

      regimeWeight:
        round3(
          regime
            ? regimeMultiplier(
                name,
                regime.regime
              )
            : 1
        ),

      finalWeight:
        round3(
          finalWeight
        ),

      peso:
        round3(
          finalWeight
        ),

      contribution:
        round1(
          contribution
        )
    };
  }

  const ordered =
    Object.entries(
      weighted
    ).sort(
      (a, b) =>
        b[1] - a[1]
    );

  const entrada =
    ordered[0]?.[0] ||
    null;

  const winnerWeight =
    Number(
      ordered[0]?.[1] ||
      0
    );

  const secondWeight =
    Number(
      ordered[1]?.[1] ||
      0
    );

  const totalWeight =
    Object.values(
      weighted
    ).reduce(
      (
        sum,
        value
      ) =>
        sum +
        Number(
          value || 0
        ),
      0
    );

  const totalVotes =
    active.length;

  const voteCount =
    entrada
      ? votes[entrada]
      : 0;

  const consensusPct =
    totalWeight > 0
      ? round1(
          (
            winnerWeight /
            totalWeight
          ) * 100
        )
      : 0;

  const votePct =
    totalVotes > 0
      ? round1(
          (
            voteCount /
            totalVotes
          ) * 100
        )
      : 0;

  const marginPct =
    totalWeight > 0
      ? round1(
          (
            (
              winnerWeight -
              secondWeight
            ) / totalWeight
          ) * 100
        )
      : 0;

  const edge =
    winnerWeight -
    secondWeight;

  let confidence = 30;

  confidence +=
    votePct *
    0.18;

  confidence +=
    consensusPct *
    0.30;

  confidence +=
    clamp(
      marginPct *
        0.20,
      0,
      10
    );

  if (
    bt?.melhor?.taxa >=
    55
  ) {
    confidence += 4;
  }

  if (
    bt?.recentRate >=
    52
  ) {
    confidence += 3;
  }

  if (
    regime?.score >=
    70
  ) {
    confidence += 3;
  }

  if (
    colors.length < 30
  ) {
    confidence -= 10;
  }

  confidence =
    Math.round(
      clamp(
        confidence,
        0,
        90
      )
    );

  if (
    totalVotes >= 4 &&
    votePct < 50
  ) {
    confidence =
      Math.min(
        confidence,
        53
      );
  }

  return {
    strategies,
    details,
    votes,
    weighted,
    active,

    activeCount:
      totalVotes,

    entrada,

    voteCount,

    totalVotes,

    votePct,

    edge,

    marginPct,

    consensusPct,

    consensusPercent:
      consensusPct,

    consensus:
      consensusPct,

    confidence,

    adaptiveWeights:
      Object.fromEntries(
        Object.entries(
          details
        ).map(
          ([
            name,
            d
          ]) => [
            name,
            d.finalWeight
          ]
        )
      )
  };
}

/* ============================================================
   ESTABILIDADE
============================================================ */

function consensusWinnerForWindow(
  colors,
  size,
  bt,
  regime
) {
  if (
    colors.length < size
  ) {
    return null;
  }

  const subset =
    colors.slice(-size);

  const c =
    calculateConsensus(
      subset,
      bt,
      regime
    );

  if (!c.entrada) {
    return null;
  }

  return c.entrada;
}

function calculateStability(
  colors,
  currentWinner,
  bt,
  regime
) {
  if (!currentWinner) {
    return {
      pct: 0,
      matches: 0,
      total: 0,
      windows: {}
    };
  }

  const sizes =
    [
      5,
      10,
      20,
      40
    ];

  const windows = {};

  let matches = 0;
  let total = 0;

  for (
    const size of sizes
  ) {
    if (
      colors.length < size
    ) {
      continue;
    }

    const winner =
      consensusWinnerForWindow(
        colors,
        size,
        bt,
        regime
      );

    windows[size] =
      winner;

    if (winner) {
      total++;

      if (
        winner ===
        currentWinner
      ) {
        matches++;
      }
    }
  }

  return {
    pct:
      total > 0
        ? round1(
            (
              matches /
              total
            ) * 100
          )
        : 0,

    matches,

    total,

    windows
  };
}

/* ============================================================
   QUALIDADE
============================================================ */

function quality(
  consensus,
  regime,
  bt,
  stability,
  colors
) {
  let q = 30;

  const cp =
    Number(
      consensus?.consensusPct
    ) || 0;

  const margin =
    Number(
      consensus?.marginPct
    ) || 0;

  const stabilityPct =
    Number(
      stability?.pct
    ) || 0;

  q +=
    Math.min(
      24,
      cp * 0.24
    );

  q +=
    Math.min(
      15,
      margin * 0.55
    );

  q +=
    Math.min(
      15,
      stabilityPct * 0.15
    );

  if (
    bt?.taxa >= 52
  ) {
    q += 3;
  }

  if (
    bt?.recentRate >= 52
  ) {
    q += 4;
  }

  if (
    regime?.score >= 70
  ) {
    q += 4;
  }

  if (
    colors.length < 30
  ) {
    q -= 10;
  }

  return Math.round(
    clamp(
      q,
      0,
      100
    )
  );
}

/* ============================================================
   DIAGNÓSTICO DE BLOQUEIOS
============================================================ */

function getBlockerLabels() {
  return {
    HISTORICO:
      "Histórico insuficiente",

    ESTRATEGIAS:
      "Poucas estratégias ativas",

    VOTOS:
      "Poucos votos",

    CONSENSO:
      "Consenso abaixo do mínimo",

    VOTOS_PCT:
      "Percentual de votos abaixo do mínimo",

    MARGEM:
      "Margem abaixo do mínimo",

    ESTABILIDADE:
      "Estabilidade abaixo do mínimo",

    BACKTEST:
      "Backtest histórico abaixo do mínimo",

    BACKTEST_RECENTE:
      "Backtest recente abaixo do mínimo",

    QUALIDADE:
      "Qualidade abaixo do mínimo",

    ESTABILIDADE_0:
      "Estabilidade 0% bloqueada",

    BRANCO:
      "Proteção do Branco",

    EMPATE:
      "Empate entre votos"
  };
}

function describeBlockers(
  blockers
) {
  const labels =
    getBlockerLabels();

  return blockers.map(
    code =>
      labels[code] ||
      code
  );
}

/* ============================================================
   ANÁLISE LOCAL
============================================================ */

function localAnalysis(
  colors,
  rolls
) {
  const regime =
    getRegime(
      colors
    );

  const bt =
    backtest(
      colors
    );

  const c =
    calculateConsensus(
      colors,
      bt,
      regime
    );

  const stability =
    calculateStability(
      colors,
      c.entrada,
      bt,
      regime
    );

  const q =
    quality(
      c,
      regime,
      bt,
      stability,
      colors
    );

  const hasEnoughData =
    colors.length >=
    CONFIG.MIN_HISTORY_SIGNAL;

  const enoughStrategies =
    c.activeCount >=
    CONFIG.MIN_ACTIVE_STRATEGIES;

  const enoughVotes =
    c.voteCount >=
    CONFIG.MIN_VOTES;

  const enoughConsensus =
    c.consensusPct >=
      CONFIG.MIN_CONSENSUS_PCT &&
    c.votePct >=
      CONFIG.MIN_VOTE_PCT;

  const consensusPctHealthy =
    c.consensusPct >=
    CONFIG.MIN_CONSENSUS_PCT;

  const votePctHealthy =
    c.votePct >=
    CONFIG.MIN_VOTE_PCT;

  const enoughMargin =
    c.marginPct >=
    CONFIG.MIN_MARGIN_PCT;

  const stable =
    stability.pct >=
    CONFIG.MIN_STABILITY_PCT;

  const bestRate =
    Number(
      bt?.melhor?.taxa
    ) || 0;

  const recentRate =
    Number(
      bt?.recentRate
    ) || 0;

  /* ==========================================================
     BACKTEST NORMAL
  ========================================================== */

  const backtestHealthyBase =
    !bt?.melhor ||
    bestRate >=
      CONFIG.MIN_BACKTEST_RATE;

  const recentHealthyBase =
    !bt?.melhor ||
    recentRate >=
      CONFIG.MIN_RECENT_RATE;

  /* ==========================================================
     SINAL FORTE ADAPTATIVO
  ========================================================== */

  const strongSetup =
    hasEnoughData &&
    enoughStrategies &&
    enoughVotes &&
    c.voteCount >=
      CONFIG.STRONG_SIGNAL_MIN_VOTES &&
    c.consensusPct >=
      CONFIG.STRONG_SIGNAL_CONSENSUS &&
    c.votePct >=
      CONFIG.STRONG_SIGNAL_VOTE_PCT &&
    c.marginPct >=
      CONFIG.STRONG_SIGNAL_MARGIN &&
    stability.pct >=
      CONFIG.STRONG_SIGNAL_STABILITY &&
    q >=
      CONFIG.STRONG_SIGNAL_QUALITY &&
    bestRate >=
      CONFIG.STRONG_SIGNAL_MIN_BACKTEST &&
    recentRate >=
      CONFIG.STRONG_SIGNAL_MIN_RECENT;

  /* ==========================================================
     BACKTEST FINAL
  ========================================================== */

  const backtestHealthy =
    backtestHealthyBase ||
    strongSetup;

  const recentHealthy =
    recentHealthyBase ||
    strongSetup;

  const adaptiveBacktestOverride =
    Boolean(
      strongSetup &&
      (
        !backtestHealthyBase ||
        !recentHealthyBase
      )
    );

  /* ==========================================================
     DIAGNÓSTICO
  ========================================================== */

  const blockers = [];

  const warnings = [];

  if (!hasEnoughData) {
    blockers.push(
      "HISTORICO"
    );
  }

  if (!enoughStrategies) {
    blockers.push(
      "ESTRATEGIAS"
    );
  }

  if (!enoughVotes) {
    blockers.push(
      "VOTOS"
    );
  }

  if (!consensusPctHealthy) {
    blockers.push(
      "CONSENSO"
    );
  }

  if (!votePctHealthy) {
    blockers.push(
      "VOTOS_PCT"
    );
  }

  if (!enoughMargin) {
    blockers.push(
      "MARGEM"
    );
  }

  if (!stable) {
    blockers.push(
      "ESTABILIDADE"
    );
  }

  if (!backtestHealthy) {
    blockers.push(
      "BACKTEST"
    );
  }

  if (!recentHealthy) {
    blockers.push(
      "BACKTEST_RECENTE"
    );
  }

  if (
    q <
    CONFIG.MIN_QUALITY
  ) {
    blockers.push(
      "QUALIDADE"
    );
  }

  if (
    stability.pct <= 0
  ) {
    blockers.push(
      "ESTABILIDADE_0"
    );
  }

  if (
    adaptiveBacktestOverride
  ) {
    warnings.push(
      "BACKTEST_ABAIXO_DO_NORMAL"
    );
  }

  /* ==========================================================
     SINAL BASE
     ----------------------------------------------------------
     IMPORTANTE:
     "sinal" é declarado ANTES de qualquer utilização.
  ========================================================== */

  let sinal =
    hasEnoughData &&
    enoughStrategies &&
    enoughVotes &&
    enoughConsensus &&
    enoughMargin &&
    stable &&
    backtestHealthy &&
    recentHealthy &&
    q >=
      CONFIG.MIN_QUALITY;

  if (
    stability.pct <= 0
  ) {
    sinal = false;
  }

  if (
    c.entrada === "B"
  ) {
    if (
      c.voteCount < 3 ||
      c.consensusPct < 64 ||
      stability.pct < 75
    ) {
      sinal = false;

      blockers.push(
        "BRANCO"
      );
    }
  }

  if (
    c.marginPct <
    CONFIG.MIN_MARGIN_PCT
  ) {
    sinal = false;

    if (
      !blockers.includes(
        "MARGEM"
      )
    ) {
      blockers.push(
        "MARGEM"
      );
    }
  }

  const sortedVotes =
    Object.entries(
      c.votes
    ).sort(
      (a, b) =>
        b[1] - a[1]
    );

  if (
    sortedVotes.length >= 2 &&
    sortedVotes[0][1] ===
      sortedVotes[1][1] &&
    sortedVotes[0][1] >= 2
  ) {
    sinal = false;

    blockers.push(
      "EMPATE"
    );
  }

  /* ==========================================================
     NORMALIZAÇÃO DOS DIAGNÓSTICOS
     ----------------------------------------------------------
     DECLARADOS ANTES DE QUALQUER USO.
  ========================================================== */

  const uniqueBlockers =
    [
      ...new Set(
        blockers
      )
    ];

  const uniqueWarnings =
    [
      ...new Set(
        warnings
      )
    ];

  /* ==========================================================
     LOG
  ========================================================== */

  if (
    uniqueWarnings.length
  ) {
    console.log(
      `[ADAPTIVE] ${uniqueWarnings.join(" | ")} | backtest=${bestRate}% | recente=${recentRate}%`
    );
  }

  if (
    uniqueBlockers.length
  ) {
    console.log(
      `[BLOCKERS] ${uniqueBlockers.join(" | ")}`
    );

    console.log(
      `[CHECK] histórico=${colors.length}/${CONFIG.MIN_HISTORY_SIGNAL} | estratégias=${c.activeCount}/${CONFIG.MIN_ACTIVE_STRATEGIES} | votos=${c.voteCount}/${CONFIG.MIN_VOTES} | consenso=${c.consensusPct}%/${CONFIG.MIN_CONSENSUS_PCT}% | votosPct=${c.votePct}%/${CONFIG.MIN_VOTE_PCT}% | margem=${c.marginPct}%/${CONFIG.MIN_MARGIN_PCT}% | estabilidade=${stability.pct}%/${CONFIG.MIN_STABILITY_PCT}% | backtest=${bestRate}%/${CONFIG.MIN_BACKTEST_RATE}% | recente=${recentRate}%/${CONFIG.MIN_RECENT_RATE}% | qualidade=${q}/${CONFIG.MIN_QUALITY}`
    );
  }

  if (
    sinal &&
    adaptiveBacktestOverride
  ) {
    console.log(
      `[STRONG SIGNAL] entrada=${c.entrada} | consenso=${c.consensusPct}% | votos=${c.voteCount}/${c.totalVotes} | margem=${c.marginPct}% | estabilidade=${stability.pct}% | qualidade=${q}% | backtest=${bestRate}% | recente=${recentRate}% | modo=ADAPTATIVO_FORTE`
    );
  }

  /* ==========================================================
     ENTRADA FINAL
  ========================================================== */

  const entradaFinal =
    sinal === true &&
    [
      "V",
      "P",
      "B"
    ].includes(
      c.entrada
    )
      ? c.entrada
      : null;

  let conf =
    Number(
      c.confidence
    ) || 0;

  if (
    sinal === true &&
    adaptiveBacktestOverride
  ) {
    conf =
      Math.min(
        90,
        conf + 2
      );
  }

  if (!sinal) {
    conf =
      Math.min(
        conf,
        49
      );
  }

  const status =
    sinal === true
      ? "SIGNAL"
      : "NO_SIGNAL";

  const blockerDescriptions =
    describeBlockers(
      uniqueBlockers
    );

  const motivo =
    sinal === true
      ? [
          `Entrada ${entradaFinal}`,
          `consenso ${c.consensusPct}%`,
          `votos ${c.voteCount}/${c.totalVotes}`,
          `margem ${c.marginPct}%`,
          `estabilidade ${stability.pct}%`,
          `qualidade ${q}%`,
          adaptiveBacktestOverride
            ? "backtest adaptativo"
            : "backtest normal"
        ].join(" · ")
      : [
          "NO SIGNAL",
          `consenso ${c.consensusPct}%`,
          `margem ${c.marginPct}%`,
          `estabilidade ${stability.pct}%`,
          `qualidade ${q}%`,
          uniqueBlockers.length
            ? `bloqueios ${uniqueBlockers.join(", ")}`
            : "sem bloqueios identificados"
        ].join(" · ");

  return {
    ok: true,

    version:
      VERSION,

    source:
      "local",

    model:
      "local-v4.1.3-adaptive",

    entrada:
      entradaFinal,

    nextEntry:
      entradaFinal,

    suggestion:
      entradaFinal,

    signal:
      entradaFinal,

    color:
      entradaFinal,

    sinal:
      Boolean(
        sinal
      ),

    hasSignal:
      Boolean(
        sinal
      ),

    status,

    conf:
      sinal === true
        ? conf
        : 0,

    confidence:
      sinal === true
        ? conf
        : 0,

    qualidade:
      q,

    quality:
      q,

    regime:
      regime.regime,

    regimeScore:
      regime.score,

    regimeInfo:
      regime,

    consenso:
      c.consensusPct,

    consensus:
      c.consensusPct,

    consensusPct:
      c.consensusPct,

    consensusPercent:
      c.consensusPct,

    consensusVotes:
      c.voteCount,

    consensusTotal:
      c.totalVotes,

    consensusVotePct:
      c.votePct,

    marginPct:
      c.marginPct,

    weightedMarginPct:
      c.marginPct,

    edge:
      c.edge,

    stabilityPct:
      stability.pct,

    stability,

    votes:
      c.votes,

    weighted:
      c.weighted,

    motivo,

    reason:
      sinal === true
        ? `Entrada ${entradaFinal} · consenso ${c.consensusPct}% · estabilidade ${stability.pct}%`
        : `Sem sinal forte · consenso ${c.consensusPct}% · margem ${c.marginPct}% · estabilidade ${stability.pct}%`,

    blockers:
      uniqueBlockers,

    bloqueios:
      uniqueBlockers,

    blockerDescriptions,

    motivosBloqueio:
      blockerDescriptions,

    warnings:
      uniqueWarnings,

    avisos:
      uniqueWarnings,

    adaptiveBacktest:
      Boolean(
        adaptiveBacktestOverride
      ),

    backtestMode:
      adaptiveBacktestOverride
        ? "ADAPTATIVO_FORTE"
        : "NORMAL",

    strongSetup:
      Boolean(
        strongSetup
      ),

    diagnostic: {
      historicoAtual:
        colors.length,

      historicoMinimo:
        CONFIG.MIN_HISTORY_SIGNAL,

      estrategiasAtivas:
        c.activeCount,

      estrategiasMinimas:
        CONFIG.MIN_ACTIVE_STRATEGIES,

      votosAtual:
        c.voteCount,

      votosMinimos:
        CONFIG.MIN_VOTES,

      consensoAtual:
        c.consensusPct,

      consensoMinimo:
        CONFIG.MIN_CONSENSUS_PCT,

      percentualVotosAtual:
        c.votePct,

      percentualVotosMinimo:
        CONFIG.MIN_VOTE_PCT,

      margemAtual:
        c.marginPct,

      margemMinima:
        CONFIG.MIN_MARGIN_PCT,

      estabilidadeAtual:
        stability.pct,

      estabilidadeMinima:
        CONFIG.MIN_STABILITY_PCT,

      backtestAtual:
        bestRate,

      backtestMinimo:
        CONFIG.MIN_BACKTEST_RATE,

      backtestNormal:
        Boolean(
          backtestHealthyBase
        ),

      backtestAdaptativo:
        Boolean(
          adaptiveBacktestOverride
        ),

      backtestPisoAdaptativo:
        CONFIG.STRONG_SIGNAL_MIN_BACKTEST,

      backtestRecenteAtual:
        recentRate,

      backtestRecenteMinimo:
        CONFIG.MIN_RECENT_RATE,

      backtestRecenteNormal:
        Boolean(
          recentHealthyBase
        ),

      backtestRecentePisoAdaptativo:
        CONFIG.STRONG_SIGNAL_MIN_RECENT,

      sinalForte:
        Boolean(
          strongSetup
        ),

      qualidadeAtual:
        q,

      qualidadeMinima:
        CONFIG.MIN_QUALITY,

      sinalBase:
        Boolean(
          hasEnoughData &&
          enoughStrategies &&
          enoughVotes &&
          enoughConsensus &&
          enoughMargin &&
          stable &&
          backtestHealthyBase &&
          recentHealthyBase &&
          q >=
            CONFIG.MIN_QUALITY
        ),

      sinalAdaptativo:
        Boolean(
          hasEnoughData &&
          enoughStrategies &&
          enoughVotes &&
          enoughConsensus &&
          enoughMargin &&
          stable &&
          backtestHealthy &&
          recentHealthy &&
          q >=
            CONFIG.MIN_QUALITY
        ),

      sinalFinal:
        Boolean(
          sinal
        )
    },

    estrategias:
      c.strategies,

    strategies:
      c.strategies,

    strategyDetails:
      c.details,

    strategyStats:
      bt.stats,

    adaptiveWeights:
      c.adaptiveWeights,

    backtest:
      bt,

    recentBacktestRate:
      bt.recentRate,

    sample:
      colors.length,

    historico:
      colors.slice(-50),

    timestamp:
      Date.now(),

    filters: {
      enoughData:
        hasEnoughData,

      enoughStrategies:
        enoughStrategies,

      enoughVotes:
        enoughVotes,

      enoughConsensus:
        enoughConsensus,

      enoughMargin:
        enoughMargin,

      stable,

      backtestHealthy,

      recentHealthy,

      backtestHealthyNormal:
        backtestHealthyBase,

      recentHealthyNormal:
        recentHealthyBase,

      adaptiveBacktestOverride,

      strongSetup,

      quality:
        q >=
        CONFIG.MIN_QUALITY,

      stabilityZeroBlocked:
        stability.pct <= 0
    },

    warning:
      "Score estatístico/heurístico. Não representa garantia ou probabilidade certa do resultado futuro."
  };
}

/* ============================================================
   PERFORMANCE
============================================================ */

const PERFORMANCE = {
  total: 0,
  wins: 0,
  losses: 0,
  history: []
};

const ROUND = {
  fingerprint: null,

  pending: null,

  lastResult: null,

  lastAnalysis: null,

  analyzing: false,

  analyzePromise: null,

  book: []
};

function performanceStats() {
  const total =
    PERFORMANCE.total;

  const rate =
    total > 0
      ? round1(
          (
            PERFORMANCE.wins /
            total
          ) * 100
        )
      : 0;

  return {
    total,

    wins:
      PERFORMANCE.wins,

    losses:
      PERFORMANCE.losses,

    acertos:
      PERFORMANCE.wins,

    erros:
      PERFORMANCE.losses,

    winRate:
      rate,

    taxa:
      rate,

    assertividade:
      rate,

    pending:
      ROUND.pending
        ? 1
        : 0,

    pendentes:
      ROUND.pending
        ? 1
        : 0,

    last:
      PERFORMANCE.history.slice(
        0,
        50
      )
  };
}

/* ============================================================
   REGISTRO
============================================================ */

function registerResult(
  entry,
  actual,
  roll,
  confidence
) {
  if (
    !entry ||
    !actual
  ) {
    return null;
  }

  const normalizedEntry =
    String(entry)
      .trim()
      .toUpperCase();

  const normalizedActual =
    String(actual)
      .trim()
      .toUpperCase();

  const win =
    normalizedEntry ===
    normalizedActual;

  PERFORMANCE.total++;

  if (win) {
    PERFORMANCE.wins++;
  } else {
    PERFORMANCE.losses++;
  }

  const row = {
    id:
      Date.now() +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 8),

    timestamp:
      new Date()
        .toISOString(),

    entrada:
      normalizedEntry,

    entry:
      normalizedEntry,

    resultado:
      normalizedActual,

    actual:
      normalizedActual,

    roll:
      roll ?? null,

    conf:
      Number(
        confidence
      ) || 0,

    status:
      win
        ? "WIN"
        : "LOSS",

    win,

    loss:
      !win
  };

  PERFORMANCE.history.unshift(
    row
  );

  if (
    PERFORMANCE.history.length >
    300
  ) {
    PERFORMANCE.history.length =
      300;
  }

  ROUND.book.unshift(
    row
  );

  if (
    ROUND.book.length >
    300
  ) {
    ROUND.book.length =
      300;
  }

  console.log(
    `[RESULT] ${
      win
        ? "WIN"
        : "LOSS"
    } | entrada=${normalizedEntry} | resultado=${normalizedActual} | roll=${roll}`
  );

  return row;
}

/* ============================================================
   FINGERPRINT
============================================================ */

function itemFingerprint(
  item
) {
  if (!item) {
    return "";
  }

  return [
    item.id || "",
    item.instant || "",
    item.roll ?? "",
    item.color || ""
  ].join("|");
}

function fingerprint(
  items
) {
  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    return "empty";
  }

  const latest =
    getLatestRound(
      items
    );

  if (!latest) {
    return "empty";
  }

  return itemFingerprint(
    latest
  );
}

/* ============================================================
   LIQUIDAÇÃO
============================================================ */

function settlePending(
  items
) {
  if (
    !ROUND.pending ||
    !Array.isArray(items) ||
    !items.length
  ) {
    return null;
  }

  const sorted =
    sortRoundsAscending(
      items
    );

  const pendingFp =
    ROUND.pending.fingerprint;

  const pendingEntry =
    ROUND.pending.entrada;

  const pendingIndex =
    sorted.findIndex(
      item =>
        itemFingerprint(
          item
        ) ===
        pendingFp
    );

  let target = null;

  if (
    pendingIndex >= 0 &&
    sorted[
      pendingIndex + 1
    ]
  ) {
    target =
      sorted[
        pendingIndex + 1
      ];
  }

  if (!target) {
    target =
      getLatestRound(
        sorted
      );
  }

  if (!target) {
    return null;
  }

  const targetFp =
    itemFingerprint(
      target
    );

  if (
    targetFp ===
    pendingFp
  ) {
    return null;
  }

  const actual =
    target.color;

  if (!actual) {
    return null;
  }

  const result =
    registerResult(
      pendingEntry,
      actual,
      target.roll,
      ROUND.pending.conf
    );

  ROUND.pending =
    null;

  ROUND.lastResult =
    result;

  console.log(
    `[SETTLE] entrada=${pendingEntry} | resultado=${target.color} | roll=${target.roll} | status=${result?.status || "-"}`
  );

  return result;
}

/* ============================================================
   JSON IA
============================================================ */

function extractJson(
  text
) {
  if (!text) {
    return null;
  }

  let clean =
    String(text)
      .replace(
        /```json/gi,
        ""
      )
      .replace(
        /```/g,
        ""
      )
      .trim();

  try {
    return JSON.parse(
      clean
    );
  } catch (_) {}

  const start =
    clean.indexOf(
      "{"
    );

  const end =
    clean.lastIndexOf(
      "}"
    );

  if (
    start >= 0 &&
    end > start
  ) {
    try {
      return JSON.parse(
        clean.slice(
          start,
          end + 1
        )
      );
    } catch (_) {}
  }

  return null;
}

/* ============================================================
   IA
============================================================ */

async function improveWithAI(
  local,
  colors
) {
  const ai =
    activeAI();

  if (!ai) {
    return {
      ...local,

      aiUsed:
        false,

      aiSuggestion:
        null,

      aiAgreement:
        null
    };
  }

  if (
    local.sinal !== true ||
    !local.entrada
  ) {
    return {
      ...local,

      entrada:
        null,

      nextEntry:
        null,

      suggestion:
        null,

      signal:
        null,

      color:
        null,

      sinal:
        false,

      hasSignal:
        false,

      status:
        "NO_SIGNAL",

      conf:
        0,

      confidence:
        0,

      aiUsed:
        false,

      aiSuggestion:
        null,

      aiAgreement:
        null,

      aiReason:
        "IA não acionada para transformar NO_SIGNAL em entrada."
    };
  }

  const models =
    ai.name === "groq"
      ? [
          ai.model,
          ...GROQ_MODELS
        ]
      : [
          ai.model
        ];

  const unique =
    [
      ...new Set(
        models.filter(
          Boolean
        )
      )
    ];

  const system = `
Você é um validador estatístico auxiliar.

Analise SOMENTE os dados fornecidos.

A decisão LOCAL é a principal referência.

Você NÃO pode criar uma entrada se o sistema local estiver em NO_SIGNAL.

Você NÃO deve tratar score como probabilidade garantida.

Não invente padrões.

Não prometa resultado.

Sua função é apenas dizer se concorda ou discorda
com a entrada local.

Responda SOMENTE JSON válido:

{
  "entrada": "V/P/B/null",
  "concorda": true,
  "conf": 0,
  "motivo": "texto curto"
}
`;

  const user =
    JSON.stringify({
      historico:
        colors.slice(-50),

      entradaLocal:
        local.entrada,

      consenso:
        local.consensusPct,

      votos:
        local.consensusVotes,

      totalVotos:
        local.consensusTotal,

      margem:
        local.marginPct,

      estabilidade:
        local.stabilityPct,

      qualidade:
        local.qualidade,

      regime:
        local.regime,

      strategyDetails:
        local.strategyDetails,

      strategyStats:
        local.strategyStats,

      backtest: {
        taxa:
          local.backtest?.taxa,

        recentRate:
          local.backtest
            ?.recentRate
      }
    });

  for (
    const model of unique
  ) {
    if (
      isCooling(model)
    ) {
      continue;
    }

    try {
      const r =
        await postJson(
          ai.base +
            "/chat/completions",

          {
            model,

            temperature: 0,

            max_tokens:
              180,

            messages: [
              {
                role:
                  "system",

                content:
                  system
              },

              {
                role:
                  "user",

                content:
                  user
              }
            ]
          },

          {
            Authorization:
              "Bearer " +
              ai.key
          }
        );

      const json =
        JSON.parse(
          r.body
        );

      const text =
        json
          ?.choices?.[0]
          ?.message
          ?.content ||
        "";

      const parsed =
        extractJson(
          text
        );

      if (!parsed) {
        continue;
      }

      let entry =
        parsed.entrada;

      if (
        entry != null
      ) {
        entry =
          String(
            entry
          )
            .toUpperCase()
            .charAt(0);
      }

      if (
        ![
          "V",
          "P",
          "B"
        ].includes(
          entry
        )
      ) {
        entry = null;
      }

      const agreement =
        entry ===
        local.entrada;

      const parsedConf =
        Number(
          parsed.conf
        );

      let conf =
        Number.isFinite(
          parsedConf
        )
          ? clamp(
              parsedConf,
              30,
              90
            )
          : local.conf;

      conf =
        Math.min(
          conf,
          Number(
            local.conf
          ) +
            CONFIG.AI_MAX_CONF_BONUS
        );

      const entradaFinal =
        local.sinal === true
          ? local.entrada
          : null;

      return {
        ...local,

        source:
          "ai",

        model,

        aiUsed:
          true,

        aiSuggestion:
          entry,

        aiAgreement:
          agreement,

        aiReason:
          String(
            parsed.motivo ||
            ""
          ).slice(
            0,
            300
          ),

        entrada:
          entradaFinal,

        nextEntry:
          entradaFinal,

        suggestion:
          entradaFinal,

        signal:
          entradaFinal,

        color:
          entradaFinal,

        sinal:
          local.sinal === true,

        hasSignal:
          local.sinal === true,

        status:
          local.sinal === true
            ? "SIGNAL"
            : "NO_SIGNAL",

        conf:
          local.sinal === true
            ? conf
            : 0,

        confidence:
          local.sinal === true
            ? conf
            : 0,

        motivo:
          `${local.motivo} · IA ${
            agreement
              ? "concorda"
              : "diverge"
          }`
      };
    } catch (err) {
      const msg =
        String(
          err.message ||
          ""
        );

      if (
        err.statusCode ===
          429 ||
        /429|rate.?limit|tokens per day|TPD/i.test(
          msg
        )
      ) {
        setCooldown(
          model,
          10 *
            60 *
            1000
        );

        console.log(
          `[ai] ${model}: limite atingido.`
        );
      }

      if (
        err.statusCode ===
          404 ||
        /model.*not.*found|does not exist|not have access/i.test(
          msg
        )
      ) {
        setCooldown(
          model,
          60 *
            60 *
            1000
        );

        console.log(
          `[ai] ${model}: modelo indisponível.`
        );
      }

      console.log(
        `[ai] erro ${model}:`,
        msg.slice(
          0,
          300
        )
      );
    }
  }

  return {
    ...local,

    aiUsed:
      false,

    aiSuggestion:
      null,

    aiAgreement:
      null
  };
}

/* ============================================================
   SANITIZAÇÃO FINAL
============================================================ */

function sanitizeAnalysisForOutput(
  data
) {
  const result = {
    ...data
  };

  const validSignal =
    result.sinal === true &&
    result.hasSignal === true &&
    result.status ===
      "SIGNAL" &&
    [
      "V",
      "P",
      "B"
    ].includes(
      result.entrada
    );

  if (!validSignal) {
    result.sinal =
      false;

    result.hasSignal =
      false;

    result.status =
      "NO_SIGNAL";

    result.entrada =
      null;

    result.nextEntry =
      null;

    result.suggestion =
      null;

    result.signal =
      null;

    result.color =
      null;

    result.conf =
      0;

    result.confidence =
      0;

    result.currentEntry =
      null;

    result.entry =
      null;

    result.displayEntry =
      null;

    result.canEnter =
      false;
  } else {
    const entry =
      result.entrada;

    result.currentEntry =
      entry;

    result.entry =
      entry;

    result.displayEntry =
      entry;

    result.canEnter =
      true;
  }

  return result;
}

/* ============================================================
   PENDING
============================================================ */

function buildPendingOutput() {
  if (
    !ROUND.pending
  ) {
    return null;
  }

  return {
    entrada:
      ROUND.pending.entrada,

    conf:
      ROUND.pending.conf,

    status:
      "PENDING",

    createdAt:
      ROUND.pending.createdAt ||
      null
  };
}

/* ============================================================
   ANALYZE INTERNO
============================================================ */

async function analyzeInternal(
  payload
) {
  payload =
    payload || {};

  let items =
    Array.isArray(
      payload.items
    )
      ? payload.items
      : null;

  if (!items) {
    const history =
      await getHistory();

    items =
      history.items;
  }

  items =
    normalizeItems(
      items,
      "input"
    );

  items =
    sortRoundsAscending(
      items
    );

  const colors =
    items.map(
      x => x.color
    );

  const rolls =
    items.map(
      x => x.roll
    );

  const fp =
    fingerprint(
      items
    );

  const force =
    Boolean(
      payload.force
    );

  if (
    ROUND.pending &&
    ROUND.pending.fingerprint !==
      fp
  ) {
    settlePending(
      items
    );
  }

  if (
    !force &&
    ROUND.fingerprint ===
      fp &&
    ROUND.lastAnalysis
  ) {
    const cached =
      sanitizeAnalysisForOutput(
        ROUND.lastAnalysis
      );

    return {
      ...cached,

      cached:
        true,

      performance:
        performanceStats(),

      book:
        ROUND.book.slice(
          0,
          50
        ),

      pending:
        buildPendingOutput(),

      pendentes:
        ROUND.pending
          ? 1
          : 0,

      lastResult:
        ROUND.lastResult
    };
  }

  ROUND.fingerprint =
    fp;

  ROUND.analyzing =
    true;

  let result =
    localAnalysis(
      colors,
      rolls
    );

  if (
    payload.useAI !== false
  ) {
    result =
      await improveWithAI(
        result,
        colors
      );
  }

  result =
    sanitizeAnalysisForOutput(
      result
    );

  if (
    result.sinal === true &&
    result.entrada &&
    !ROUND.pending
  ) {
    ROUND.pending = {
      fingerprint:
        fp,

      entrada:
        result.entrada,

      conf:
        result.conf,

      createdAt:
        Date.now(),

      regime:
        result.regime,

      consensus:
        result.consensus,

      quality:
        result.qualidade,

      stability:
        result.stabilityPct,

      backtestMode:
        result.backtestMode ||
        "NORMAL"
    };

    console.log(
      `[ENTRY] ${result.entrada} | conf=${result.conf}% | consenso=${result.consensus}% | margem=${result.marginPct}% | estabilidade=${result.stabilityPct}% | qualidade=${result.qualidade}% | regime=${result.regime} | modo=${result.backtestMode || "NORMAL"}`
    );
  } else if (
    result.sinal === true &&
    result.entrada &&
    ROUND.pending
  ) {
    console.log(
      `[ENTRY] já existe entrada pendente: ${ROUND.pending.entrada}`
    );
  } else {
    console.log(
      `[NO SIGNAL] consenso=${result.consensus}% | margem=${result.marginPct}% | estabilidade=${result.stabilityPct}% | qualidade=${result.qualidade}% | regime=${result.regime} | bloqueios=${(result.blockers || []).join(",") || "NENHUM"}`
    );
  }

  ROUND.lastAnalysis =
    result;

  ROUND.analyzing =
    false;

  return {
    ...result,

    cached:
      false,

    performance:
      performanceStats(),

    book:
      ROUND.book.slice(
        0,
        50
      ),

    pending:
      buildPendingOutput(),

    pendentes:
      ROUND.pending
        ? 1
        : 0,

    lastResult:
      ROUND.lastResult
  };
}

/* ============================================================
   ANALYZE COM LOCK
============================================================ */

async function analyze(
  payload
) {
  if (
    ROUND.analyzePromise
  ) {
    console.log(
      "[ANALYZE] requisição aguardando análise atual..."
    );

    return ROUND.analyzePromise;
  }

  ROUND.analyzePromise =
    analyzeInternal(
      payload
    )
      .catch(
        err => {
          throw err;
        }
      )
      .finally(
        () => {
          ROUND.analyzePromise =
            null;

          ROUND.analyzing =
            false;
        }
      );

  return ROUND.analyzePromise;
}

/* ============================================================
   BODY
============================================================ */

function readBody(
  req
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      let data = "";

      req.on(
        "data",
        chunk => {
          data += chunk;

          if (
            data.length >
            5 *
              1024 *
              1024
          ) {
            reject(
              new Error(
                "Body muito grande."
              )
            );

            req.destroy();
          }
        }
      );

      req.on(
        "end",
        () =>
          resolve(
            data
          )
      );

      req.on(
        "error",
        reject
      );
    }
  );
}

function sendJson(
  res,
  status,
  data
) {
  res.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store",

      "Access-Control-Allow-Origin":
        "*"
    }
  );

  res.end(
    JSON.stringify(
      data
    )
  );
}

/* ============================================================
   MIME
============================================================ */

const MIME = {
  ".html":
    "text/html; charset=utf-8",

  ".js":
    "application/javascript; charset=utf-8",

  ".css":
    "text/css; charset=utf-8",

  ".json":
    "application/json; charset=utf-8",

  ".png":
    "image/png",

  ".jpg":
    "image/jpeg",

  ".jpeg":
    "image/jpeg",

  ".svg":
    "image/svg+xml",

  ".webp":
    "image/webp",

  ".ico":
    "image/x-icon"
};

/* ============================================================
   SERVER
============================================================ */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,OPTIONS"
      );

      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
      );

      if (
        req.method ===
        "OPTIONS"
      ) {
        res.writeHead(
          204
        );

        res.end();

        return;
      }

      let url;

      try {
        url =
          new URL(
            req.url,
            `http://localhost:${PORT}`
          );
      } catch (_) {
        sendJson(
          res,
          400,
          {
            ok: false,

            error:
              "URL inválida"
          }
        );

        return;
      }

      if (
        url.pathname ===
        "/api/status"
      ) {
        const ai =
          activeAI();

        const current =
          sanitizeAnalysisForOutput(
            ROUND.lastAnalysis ||
              {}
          );

        sendJson(
          res,
          200,
          {
            ok: true,

            version:
              VERSION,

            server:
              "online",

            analyzing:
              Boolean(
                ROUND.analyzePromise
              ),

            ai:
              Boolean(ai),

            provider:
              ai?.name ||
              "local",

            model:
              ai?.model ||
              "local-v4.1.3-adaptive",

            performance:
              performanceStats(),

            pending:
              Boolean(
                ROUND.pending
              ),

            pendingEntry:
              ROUND.pending
                ?.entrada ||
              null,

            entrada:
              current.sinal === true
                ? current.entrada
                : null,

            sinal:
              current.sinal === true,

            status:
              current.sinal === true
                ? "SIGNAL"
                : "NO_SIGNAL",

            consensus:
              Number(
                current.consensus
              ) || 0,

            consensusPct:
              Number(
                current.consensusPct
              ) || 0,

            marginPct:
              Number(
                current.marginPct
              ) || 0,

            stabilityPct:
              Number(
                current.stabilityPct
              ) || 0,

            regime:
              current.regime ||
              null,

            quality:
              Number(
                current.qualidade
              ) || 0,

            blockers:
              current.blockers ||
              [],

            bloqueios:
              current.bloqueios ||
              [],

            blockerDescriptions:
              current.blockerDescriptions ||
              [],

            warnings:
              current.warnings ||
              [],

            avisos:
              current.avisos ||
              [],

            adaptiveBacktest:
              Boolean(
                current.adaptiveBacktest
              ),

            backtestMode:
              current.backtestMode ||
              "NORMAL",

            strongSetup:
              Boolean(
                current.strongSetup
              ),

            diagnostic:
              current.diagnostic ||
              null
          }
        );

        return;
      }

      if (
        url.pathname ===
        "/api/history"
      ) {
        try {
          const h =
            await getHistory();

          const items =
            sortRoundsAscending(
              h.items
            );

          sendJson(
            res,
            200,
            {
              ok: true,

              version:
                VERSION,

              source:
                h.source,

              items
            }
          );
        } catch (err) {
          sendJson(
            res,
            500,
            {
              ok: false,

              error:
                err.message
            }
          );
        }

        return;
      }

      if (
        url.pathname ===
        "/api/live"
      ) {
        try {
          const h =
            await getHistory();

          const items =
            sortRoundsAscending(
              h.items
            );

          sendJson(
            res,
            200,
            {
              ok: true,

              source:
                h.source,

              items,

              latest:
                items[
                  items.length - 1
                ] || null
            }
          );
        } catch (err) {
          sendJson(
            res,
            500,
            {
              ok: false,

              error:
                err.message
            }
          );
        }

        return;
      }

      if (
        url.pathname ===
        "/api/ai"
      ) {
        if (
          req.method !==
          "POST"
        ) {
          sendJson(
            res,
            405,
            {
              ok: false,

              error:
                "Use POST."
            }
          );

          return;
        }

        try {
          const raw =
            await readBody(
              req
            );

          let payload = {};

          if (raw) {
            payload =
              JSON.parse(
                raw
              );
          }

          const result =
            await analyze(
              payload
            );

          const safeResult =
            sanitizeAnalysisForOutput(
              result
            );

          sendJson(
            res,
            200,
            safeResult
          );
        } catch (err) {
          console.log(
            "[api/ai]",
            err.message
          );

          sendJson(
            res,
            500,
            {
              ok: false,

              error:
                err.message,

              entrada:
                null,

              nextEntry:
                null,

              suggestion:
                null,

              signal:
                null,

              color:
                null,

              currentEntry:
                null,

              entry:
                null,

              displayEntry:
                null,

              canEnter:
                false,

              sinal:
                false,

              hasSignal:
                false,

              status:
                "NO_SIGNAL",

              conf:
                0,

              confidence:
                0,

              qualidade:
                0,

              quality:
                0,

              consenso:
                0,

              consensus:
                0,

              consensusPct:
                0,

              consensusVotes:
                0,

              consensusTotal:
                0,

              consensusVotePct:
                0,

              marginPct:
                0,

              stabilityPct:
                0,

              blockers:
                [
                  "ERRO_ANALISE"
                ],

              bloqueios:
                [
                  "ERRO_ANALISE"
                ],

              blockerDescriptions:
                [
                  "Erro durante a análise"
                ],

              pendentes:
                ROUND.pending
                  ? 1
                  : 0,

              pending:
                buildPendingOutput(),

              performance:
                performanceStats()
            }
          );
        }

        return;
      }

      if (
        url.pathname ===
        "/api/performance"
      ) {
        sendJson(
          res,
          200,
          {
            ok: true,

            version:
              VERSION,

            ...performanceStats()
          }
        );

        return;
      }

      if (
        url.pathname ===
        "/api/book"
      ) {
        const pending =
          buildPendingOutput();

        sendJson(
          res,
          200,
          {
            ok: true,

            version:
              VERSION,

            ...performanceStats(),

            wins:
              PERFORMANCE.wins,

            losses:
              PERFORMANCE.losses,

            acertos:
              PERFORMANCE.wins,

            erros:
              PERFORMANCE.losses,

            pendentes:
              pending
                ? 1
                : 0,

            pending,

            book:
              ROUND.book.slice(
                0,
                100
              )
          }
        );

        return;
      }

      if (
        url.pathname ===
        "/api/regime"
      ) {
        try {
          const h =
            await getHistory();

          const colors =
            sortRoundsAscending(
              h.items
            ).map(
              x =>
                x.color
            );

          sendJson(
            res,
            200,
            {
              ok: true,

              ...getRegime(
                colors
              )
            }
          );
        } catch (err) {
          sendJson(
            res,
            500,
            {
              ok: false,

              error:
                err.message
            }
          );
        }

        return;
      }

      if (
        url.pathname ===
        "/api/backtest"
      ) {
        try {
          const h =
            await getHistory(
              true
            );

          const colors =
            sortRoundsAscending(
              h.items
            ).map(
              x =>
                x.color
            );

          const bt =
            backtest(
              colors
            );

          sendJson(
            res,
            200,
            {
              ok: true,

              version:
                VERSION,

              ...bt,

              adaptiveConfig: {
                normalHistoricalMinimum:
                  CONFIG.MIN_BACKTEST_RATE,

                normalRecentMinimum:
                  CONFIG.MIN_RECENT_RATE,

                strongConsensus:
                  CONFIG.STRONG_SIGNAL_CONSENSUS,

                strongVotePct:
                  CONFIG.STRONG_SIGNAL_VOTE_PCT,

                strongMargin:
                  CONFIG.STRONG_SIGNAL_MARGIN,

                strongStability:
                  CONFIG.STRONG_SIGNAL_STABILITY,

                strongQuality:
                  CONFIG.STRONG_SIGNAL_QUALITY,

                strongMinVotes:
                  CONFIG.STRONG_SIGNAL_MIN_VOTES,

                adaptiveHistoricalFloor:
                  CONFIG.STRONG_SIGNAL_MIN_BACKTEST,

                adaptiveRecentFloor:
                  CONFIG.STRONG_SIGNAL_MIN_RECENT
              }
            }
          );
        } catch (err) {
          sendJson(
            res,
            500,
            {
              ok: false,

              error:
                err.message
            }
          );
        }

        return;
      }

      if (
        url.pathname ===
        "/api/reset"
      ) {
        PERFORMANCE.total =
          0;

        PERFORMANCE.wins =
          0;

        PERFORMANCE.losses =
          0;

        PERFORMANCE.history =
          [];

        ROUND.fingerprint =
          null;

        ROUND.pending =
          null;

        ROUND.lastResult =
          null;

        ROUND.lastAnalysis =
          null;

        ROUND.analyzing =
          false;

        ROUND.analyzePromise =
          null;

        ROUND.book =
          [];

        MODEL_COOLDOWN.clear();

        historyCache = {
          data: null,
          time: 0
        };

        sendJson(
          res,
          200,
          {
            ok: true,

            message:
              "Sistema resetado.",

            performance:
              performanceStats()
          }
        );

        return;
      }

      let file;

      try {
        file =
          decodeURIComponent(
            url.pathname
          );
      } catch (_) {
        file =
          "/index.html";
      }

      if (
        file === "/"
      ) {
        file =
          "/index.html";
      }

      const fullPath =
        path.normalize(
          path.join(
            ROOT,
            file
          )
        );

      if (
        !fullPath.startsWith(
          path.normalize(
            ROOT +
              path.sep
          )
        )
      ) {
        res.writeHead(
          403
        );

        res.end(
          "Forbidden"
        );

        return;
      }

      fs.readFile(
        fullPath,
        (
          err,
          data
        ) => {
          if (err) {
            res.writeHead(
              404
            );

            res.end(
              "Not Found"
            );

            return;
          }

          const ext =
            path.extname(
              fullPath
            ).toLowerCase();

          res.writeHead(
            200,
            {
              "Content-Type":
                MIME[ext] ||
                "application/octet-stream",

              "Cache-Control":
                ext === ".html" ||
                ext === ".js"
                  ? "no-cache"
                  : "public,max-age=3600"
            }
          );

          res.end(
            data
          );
        }
      );
    }
  );

/* ============================================================
   ERRO
============================================================ */

server.on(
  "error",
  err => {
    console.error(
      "[server]",
      err.message
    );
  }
);

/* ============================================================
   START
============================================================ */

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");

    console.log(
      "=================================================="
    );

    console.log(
      "        RIFT DOUBLE RADAR V4.1.3"
    );

    console.log(
      "           ADAPTIVE ENGINE"
    );

    console.log(
      "=================================================="
    );

    console.log(
      `Servidor: http://localhost:${PORT}`
    );

    const ai =
      activeAI();

    console.log(
      "IA:",
      ai
        ? `${ai.name} / ${ai.model}`
        : "LOCAL"
    );

    console.log(
      "Entrada:",
      "ATIVA"
    );

    console.log(
      "Ensemble adaptativo:",
      "ATIVO"
    );

    console.log(
      "Pesos por desempenho:",
      "ATIVOS"
    );

    console.log(
      "Walk-forward:",
      "ATIVO"
    );

    console.log(
      "Backtest recente:",
      "ATIVO"
    );

    console.log(
      "Backtest histórico:",
      "ATIVO"
    );

    console.log(
      "Backtest adaptativo:",
      "ATIVO"
    );

    console.log(
      "Detector de regime:",
      "ATIVO"
    );

    console.log(
      "Detector de estabilidade:",
      "ATIVO"
    );

    console.log(
      "Margem de consenso:",
      "ATIVA"
    );

    console.log(
      "Filtro NO SIGNAL:",
      "ADAPTATIVO"
    );

    console.log(
      "Diagnóstico de bloqueios:",
      "ATIVO"
    );

    console.log(
      "Proteção estabilidade 0%:",
      "ATIVA"
    );

    console.log(
      "Proteção Branco:",
      "ATIVA"
    );

    console.log(
      "IA como validadora:",
      "ATIVA"
    );

    console.log(
      "WIN/LOSS:",
      "ATIVO"
    );

    console.log(
      "Livro:",
      "ATIVO"
    );

    console.log(
      "Performance:",
      "ATIVA"
    );

    console.log(
      "14 estratégias:",
      "ATIVAS"
    );

    console.log(
      "Force re-analysis:",
      "ATIVO"
    );

    console.log(
      "Analysis lock:",
      "ATIVO"
    );

    console.log(
      "Liquidação pela próxima rodada:",
      "ATIVA"
    );

    console.log(
      "Proteção entrada sem sinal:",
      "ATIVA"
    );

    console.log(
      "=================================================="
    );

    console.log("");

    console.log(
      "[CONFIG]",
      `mínimo histórico=${CONFIG.MIN_HISTORY_SIGNAL}`
    );

    console.log(
      "[CONFIG]",
      `mínimo consenso=${CONFIG.MIN_CONSENSUS_PCT}%`
    );

    console.log(
      "[CONFIG]",
      `mínima margem=${CONFIG.MIN_MARGIN_PCT}%`
    );

    console.log(
      "[CONFIG]",
      `mínima estabilidade=${CONFIG.MIN_STABILITY_PCT}%`
    );

    console.log(
      "[CONFIG]",
      `qualidade mínima=${CONFIG.MIN_QUALITY}`
    );

    console.log(
      "[CONFIG]",
      `backtest mínimo=${CONFIG.MIN_BACKTEST_RATE}%`
    );

    console.log(
      "[CONFIG]",
      `backtest recente mínimo=${CONFIG.MIN_RECENT_RATE}%`
    );

    console.log(
      "[CONFIG]",
      `backtest adaptativo histórico >= ${CONFIG.STRONG_SIGNAL_MIN_BACKTEST}%`
    );

    console.log(
      "[CONFIG]",
      `backtest adaptativo recente >= ${CONFIG.STRONG_SIGNAL_MIN_RECENT}%`
    );

    console.log(
      "[CONFIG]",
      `sinal forte consenso >= ${CONFIG.STRONG_SIGNAL_CONSENSUS}%`
    );

    console.log(
      "[CONFIG]",
      `sinal forte votos >= ${CONFIG.STRONG_SIGNAL_VOTE_PCT}%`
    );

    console.log(
      "[CONFIG]",
      `sinal forte margem >= ${CONFIG.STRONG_SIGNAL_MARGIN}%`
    );

    console.log(
      "[CONFIG]",
      `sinal forte estabilidade >= ${CONFIG.STRONG_SIGNAL_STABILITY}%`
    );

    console.log(
      "[CONFIG]",
      `sinal forte qualidade >= ${CONFIG.STRONG_SIGNAL_QUALITY}`
    );

    console.log(
      "[CONFIG]",
      `sinal forte mínimo de votos=${CONFIG.STRONG_SIGNAL_MIN_VOTES}`
    );

    console.log(
      "[CONFIG]",
      "backtest histórico = 1%"
    );

    console.log(
      "[CONFIG]",
      "backtest recente = 1%"
    );

    console.log(
      "[CONFIG]",
      "piso adaptativo histórico = 1%"
    );

    console.log(
      "[CONFIG]",
      "piso adaptativo recente = 1%"
    );

    console.log(
      "[CONFIG]",
      "diagnóstico de bloqueios=ATIVO"
    );

    console.log(
      "[CONFIG]",
      "estabilidade 0% = BLOQUEIO"
    );

    console.log(
      "[CONFIG]",
      "backtest adaptativo = ATIVO"
    );

    console.log("");

    console.log(
      "⚠️ BACKTEST CONFIGURADO EM 1%"
    );

    console.log(
      "⚠️ O backtest deixa de ser um filtro forte de qualidade."
    );

    console.log("");
  }
);