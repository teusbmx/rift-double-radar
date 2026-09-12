"use strict";

/*
============================================================
 RIFT DOUBLE RADAR
 SERVER ONLINE
============================================================

 Compatível com:
 - Railway
 - Render
 - VPS
 - Node.js 18+

 Arquivos:
   server.js
   index.html
   package.json

============================================================
*/

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

/*
============================================================
 CONFIGURAÇÃO DO SERVIDOR
============================================================
*/

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";

/*
 IMPORTANTE:
 ROOT precisa existir antes de qualquer função
 que utilize os arquivos do projeto.
*/
const ROOT = __dirname;

const VERSION = "RIFT Double Radar ONLINE 5.0.1";

/*
============================================================
 FONTES
============================================================
*/

const TIPMINER_URL =
  "https://api.core.public.tipminer.com/v1/double/rounds/6ee2f33f-7dbf-40ae-b01c-b05368c806ba/history?limit=200&timezone=UTC";

const BLAZE_URLS = [
  "https://blaze.bet.br/api/roulette_games/recent",
  "https://blaze.com/api/roulette_games/recent"
];

/*
============================================================
 CONFIGURAÇÃO DO RADAR
============================================================
*/

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
  Backtest
  */

  MIN_BACKTEST_RATE: 1,

  MIN_RECENT_RATE: 1,

  /*
  Sinal forte
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
  Janelas
  */

  RECENT_WINDOW: 60,

  LONG_WINDOW: 180,

  /*
  Suavização
  */

  PRIOR_RATE: 50,

  PRIOR_STRENGTH: 12,

  MAX_WEIGHT_FACTOR: 1.45,

  MIN_WEIGHT_FACTOR: 0.45,

  WHITE_MAX_WEIGHT: 0.90
};

/*
============================================================
 IA
============================================================
*/

const GROQ_DEFAULT_MODEL =
  process.env.GROQ_MODEL ||
  "openai/gpt-oss-20b";

const GROQ_API_KEY =
  process.env.GROQ_API_KEY || "";

const XAI_API_KEY =
  process.env.XAI_API_KEY || "";

const XAI_MODEL =
  process.env.XAI_MODEL ||
  "grok-3-mini";

const AI_PROVIDER =
  String(
    process.env.AI_PROVIDER ||
    "auto"
  ).toLowerCase();

const MODEL_COOLDOWN =
  new Map();

/*
============================================================
 UTILITÁRIOS HTTP
============================================================
*/

function requestUrl(
  target,
  options = {}
) {
  return new Promise(
    (resolve, reject) => {
      let url;

      try {
        url = new URL(target);
      } catch (err) {
        reject(
          new Error(
            "URL inválida"
          )
        );
        return;
      }

      const lib =
        url.protocol === "https:"
          ? https
          : http;

      const method =
        options.method ||
        "GET";

      const body =
        options.body || "";

      const timeout =
        options.timeout ||
        15000;

      const headers = {
        "User-Agent":
          "Mozilla/5.0 RIFT-Double-Radar",
        "Accept":
          "application/json, text/plain, */*",
        "Cache-Control":
          "no-cache",
        "Pragma":
          "no-cache",
        ...(options.headers || {})
      };

      if (body) {
        headers[
          "Content-Type"
        ] =
          "application/json";

        headers[
          "Content-Length"
        ] =
          Buffer.byteLength(body);
      }

      const req =
        lib.request(
          {
            hostname:
              url.hostname,

            port:
              url.port ||
              undefined,

            path:
              url.pathname +
              url.search,

            method,

            timeout,

            headers
          },

          res => {
            let data = "";

            res.setEncoding(
              "utf8"
            );

            res.on(
              "data",
              chunk => {
                data += chunk;
              }
            );

            res.on(
              "end",
              () => {
                resolve({
                  status:
                    res.statusCode ||
                    0,

                  headers:
                    res.headers,

                  body:
                    data
                });
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

      if (body) {
        req.write(body);
      }

      req.end();
    }
  );
}

async function fetchJson(
  url,
  timeout = 15000
) {
  const result =
    await requestUrl(
      url,
      {
        method: "GET",
        timeout
      }
    );

  if (
    result.status < 200 ||
    result.status >= 300
  ) {
    throw new Error(
      `HTTP ${result.status}: ${result.body.slice(
        0,
        500
      )}`
    );
  }

  try {
    return JSON.parse(
      result.body
    );
  } catch (err) {
    throw new Error(
      "Resposta não é JSON válido"
    );
  }
}

async function postJson(
  url,
  body,
  headers = {},
  timeout = 30000
) {
  const result =
    await requestUrl(
      url,
      {
        method: "POST",
        timeout,
        body:
          JSON.stringify(
            body
          ),
        headers
      }
    );

  if (
    result.status < 200 ||
    result.status >= 300
  ) {
    const error =
      new Error(
        `HTTP ${result.status}: ${result.body.slice(
          0,
          1000
        )}`
      );

    error.statusCode =
      result.status;

    throw error;
  }

  try {
    return JSON.parse(
      result.body
    );
  } catch (_) {
    return {
      raw:
        result.body
    };
  }
}

/*
============================================================
 NORMALIZAÇÃO
============================================================
*/

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
    s === "R" ||
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
    s === "W" ||
    s === "0"
  ) {
    return "B";
  }

  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
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

function extractArray(
  json
) {
  if (
    Array.isArray(json)
  ) {
    return json;
  }

  const candidates = [
    json?.data,
    json?.rounds,
    json?.results,
    json?.items,
    json?.history,

    json?.data?.rounds,
    json?.data?.results,
    json?.data?.items,
    json?.data?.history
  ];

  for (
    const item of candidates
  ) {
    if (
      Array.isArray(item)
    ) {
      return item;
    }
  }

  return [];
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
    .map(
      (item, index) => {
        if (
          item === null ||
          item === undefined
        ) {
          return null;
        }

        if (
          typeof item ===
          "number"
        ) {
          const roll =
            Number(item);

          const color =
            normalizeColor(
              roll
            );

          if (!color) {
            return null;
          }

          return {
            roll,
            color,
            id:
              `${source}-${index}`,
            instant:
              null,
            source
          };
        }

        const rawRoll =
          item?.roll ??
          item?.result ??
          item?.number ??
          item?.value ??
          item?.winningNumber ??
          item?.winning_number ??
          item?.rouletteNumber ??
          item?.roulette_number ??
          item?.game?.roll ??
          item?.game?.number ??
          item?.outcome?.number;

        let roll =
          Number(rawRoll);

        if (
          !Number.isFinite(
            roll
          )
        ) {
          roll = null;
        }

        let color =
          normalizeColor(
            item?.color ??
            item?.colour ??
            item?.colorName ??
            item?.color_name ??
            item?.resultColor ??
            item?.result_color ??
            item?.game?.color ??
            item?.outcome?.color
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
          roll,

          color,

          id:
            item?.id ??
            item?.uuid ??
            item?.round_id ??
            item?.roundId ??
            item?.game_id ??
            item?.gameId ??
            `${source}-${index}`,

          instant:
            item?.instant ??
            item?.timestamp ??
            item?.created_at ??
            item?.createdAt ??
            item?.updated_at ??
            item?.date ??
            item?.time ??
            null,

          source
        };
      }
    )
    .filter(Boolean);
}

/*
============================================================
 HISTÓRICO
============================================================
*/

let historyCache = {
  data: null,
  time: 0
};

let sourceStatus = {
  source: null,

  lastSuccess: null,

  lastError: null,

  tipminer:
    "unknown",

  blaze:
    "unknown"
};

async function getHistory(
  force = false
) {
  if (
    !force &&
    historyCache.data &&
    Date.now() -
      historyCache.time <
      1200
  ) {
    return historyCache.data;
  }

  /*
  ----------------------------------------------------------
  TIPMINER
  ----------------------------------------------------------
  */

  try {
    console.log(
      "[history] consultando TipMiner..."
    );

    const json =
      await fetchJson(
        TIPMINER_URL,
        15000
      );

    const arr =
      extractArray(json);

    console.log(
      `[history] TipMiner bruto: ${arr.length}`
    );

    const items =
      normalizeItems(
        arr,
        "tipminer"
      );

    console.log(
      `[history] TipMiner normalizado: ${items.length}`
    );

    if (
      items.length > 0
    ) {
      sourceStatus = {
        ...sourceStatus,

        source:
          "tipminer",

        tipminer:
          "online",

        lastSuccess:
          new Date().toISOString(),

        lastError:
          null
      };

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

    sourceStatus.tipminer =
      "empty";
  } catch (err) {
    sourceStatus.tipminer =
      "offline";

    sourceStatus.lastError =
      err.message;

    console.log(
      "[history] TipMiner:",
      err.message
    );
  }

  /*
  ----------------------------------------------------------
  BLAZE
  ----------------------------------------------------------
  */

  for (
    const url of BLAZE_URLS
  ) {
    try {
      console.log(
        "[history] tentando Blaze:",
        url
      );

      const json =
        await fetchJson(
          url,
          15000
        );

      const arr =
        extractArray(json);

      const items =
        normalizeItems(
          arr,
          "blaze"
        );

      console.log(
        `[history] Blaze normalizado: ${items.length}`
      );

      if (
        items.length > 0
      ) {
        sourceStatus = {
          ...sourceStatus,

          source:
            "blaze",

          blaze:
            "online",

          lastSuccess:
            new Date().toISOString(),

          lastError:
            null
        };

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
        "[history] Blaze:",
        err.message
      );
    }
  }

  throw new Error(
    "Não foi possível obter o histórico das fontes externas."
  );
}

/*
============================================================
 ORDENAÇÃO
============================================================
*/

function itemTime(
  item
) {
  if (!item) {
    return NaN;
  }

  if (
    item.instant === null ||
    item.instant ===
      undefined
  ) {
    return NaN;
  }

  const t =
    new Date(
      item.instant
    ).getTime();

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

  const valid =
    items.filter(
      item =>
        Number.isFinite(
          itemTime(item)
        )
    );

  if (
    valid.length >= 2
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
          Number.isFinite(ta) &&
          Number.isFinite(tb)
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

/*
============================================================
 UTILITÁRIOS
============================================================
*/

function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(
      max,
      Number(value) || 0
    )
  );
}

function round1(
  value
) {
  return (
    Math.round(
      Number(value || 0) *
        10
    ) / 10
  );
}

/*
 IMPORTANTE:
 round3 estava sendo utilizada
 no backtest, mas não existia.
*/
function round3(
  value
) {
  return (
    Math.round(
      Number(value || 0) *
        1000
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
    ) *
      100
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
  if (
    !colors.length
  ) {
    return {
      color:
        null,

      length:
        0
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

/*
============================================================
 ESTRATÉGIAS
============================================================
*/

function markov(
  colors
) {
  if (
    colors.length < 5
  ) {
    return {
      entrada:
        null,

      score:
        0
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
    i <
      colors.length - 1;
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
      entrada:
        null,

      score:
        0
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
      entrada:
        null,

      score:
        0
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
      entrada:
        null,

      score:
        0
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
      entrada:
        null,

      score:
        0,

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
      entrada:
        null,

      score:
        0
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
          ) *
            0.8
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
      entrada:
        null,

      score:
        0
    };
  }

  const d =
    density(recent);

  if (
    d.V === d.P
  ) {
    return {
      entrada:
        null,

      score:
        0
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
      entrada:
        null,

      score:
        0
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
      entrada:
        null,

      score:
        0
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
    entrada:
      null,

    score:
      0
  };
}

function transitionStrategy(
  colors
) {
  if (
    colors.length < 8
  ) {
    return {
      entrada:
        null,

      score:
        0
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
      entrada:
        null,

      score:
        0
    };
  }

  const entries =
    Object.entries(row)
      .sort(
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
      entrada:
        null,

      score:
        0
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
      entrada:
        "P",

      score:
        72,

      dados:
        d
    };
  }

  if (
    d.P >= 65 &&
    d.V <= 35
  ) {
    return {
      entrada:
        "V",

      score:
        72,

      dados:
        d
    };
  }

  return {
    entrada:
      null,

    score:
      0
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
      entrada:
        null,

      score:
        0
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
      entrada:
        null,

      score:
        0
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
      entrada:
        null,

      score:
        0
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
          ) *
            2
      ),

    dados: {
      V: v,
      P: p
    }
  };
}

/*
============================================================
 REGISTRY
============================================================
*/

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
  markov:
    1.25,

  density:
    1.00,

  streak:
    0.90,

  alternation:
    0.90,

  white:
    0.55,

  frequency:
    1.00,

  window5:
    0.90,

  window10:
    1.00,

  window20:
    1.00,

  repeat:
    0.80,

  transition:
    1.15,

  pressure:
    1.00,

  lastPair:
    0.75,

  balance:
    0.80
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

/*
============================================================
 BACKTEST
============================================================
*/

function emptyStats(
  name
) {
  return {
    estrategia:
      name,

    nome:
      STRATEGY_LABELS[name] ||
      name,

    testes:
      0,

    acertos:
      0,

    erros:
      0,

    taxa:
      0,

    testesRecentes:
      0,

    acertosRecentes:
      0,

    recenteTaxa:
      0,

    taxaAjustada:
      50,

    confiabilidade:
      0,

    peso:
      0,

    fator:
      1
  };
}

function smoothedRate(
  wins,
  tests
) {
  return (
    (
      Number(wins || 0) +
      CONFIG.PRIOR_RATE *
        CONFIG.PRIOR_STRENGTH
    ) /
    (
      Number(tests || 0) +
      CONFIG.PRIOR_STRENGTH
    )
  );
}

function runStrategy(
  name,
  colors
) {
  const strategies =
    getStrategies(
      colors
    );

  return (
    strategies[name] || {
      entrada:
        null,

      score:
        0
    }
  );
}

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
      melhor:
        null,
      amostra:
        0,
      adaptive:
        true
    };
  }

  for (
    let i = 20;
    i <
      colors.length;
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
      const result =
        strategies[name];

      if (
        !result ||
        ![
          "V",
          "P",
          "B"
        ].includes(
          result.entrada
        )
      ) {
        continue;
      }

      const stat =
        stats[name];

      stat.testes++;

      if (
        result.entrada ===
        actual
      ) {
        stat.acertos++;
      } else {
        stat.erros++;
      }
    }
  }

  const recentStart =
    Math.max(
      20,
      colors.length -
        CONFIG.RECENT_WINDOW
    );

  for (
    let i =
      recentStart;
    i <
      colors.length;
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
      const result =
        strategies[name];

      if (
        !result ||
        ![
          "V",
          "P",
          "B"
        ].includes(
          result.entrada
        )
      ) {
        continue;
      }

      const stat =
        stats[name];

      stat.testesRecentes++;

      if (
        result.entrada ===
        actual
      ) {
        stat.acertosRecentes++;
      }
    }
  }

  const ranking = [];

  for (
    const name of names
  ) {
    const stat =
      stats[name];

    stat.taxa =
      stat.testes
        ? pct(
            stat.acertos,
            stat.testes
          )
        : 0;

    stat.recenteTaxa =
      stat.testesRecentes
        ? pct(
            stat.acertosRecentes,
            stat.testesRecentes
          )
        : 0;

    stat.taxaAjustada =
      round1(
        smoothedRate(
          stat.acertos,
          stat.testes
        )
      );

    const confidenceSample =
      clamp(
        stat.testes /
          40,
        0,
        1
      );

    stat.confiabilidade =
      round1(
        stat.taxaAjustada *
          confidenceSample +
          50 *
            (
              1 -
              confidenceSample
            )
      );

    const base =
      BASE_WEIGHTS[
        name
      ] || 1;

    let factor =
      1 +
      (
        stat.taxaAjustada -
        50
      ) /
        100;

    factor =
      clamp(
        factor,
        CONFIG.MIN_WEIGHT_FACTOR,
        CONFIG.MAX_WEIGHT_FACTOR
      );

    if (
      name === "white"
    ) {
      factor =
        Math.min(
          factor,
          CONFIG.WHITE_MAX_WEIGHT
        );
    }

    stat.fator =
      round1(
        factor
      );

    stat.peso =
      round3(
        base *
          factor
      );

    ranking.push({
      estrategia:
        name,

      nome:
        stat.nome,

      taxa:
        stat.taxa,

      recenteTaxa:
        stat.recenteTaxa,

      taxaAjustada:
        stat.taxaAjustada,

      confiabilidade:
        stat.confiabilidade,

      peso:
        stat.peso,

      testes:
        stat.testes
    });
  }

  ranking.sort(
    (a, b) =>
      (
        b.taxaAjustada +
        b.recenteTaxa
      ) -
      (
        a.taxaAjustada +
        a.recenteTaxa
      )
  );

  return {
    stats,

    ranking,

    melhor:
      ranking[0] ||
      null,

    amostra:
      colors.length,

    adaptive:
      true
  };
}

/*
============================================================
 REGIME
============================================================
*/

function detectRegime(
  colors
) {
  if (
    colors.length < 10
  ) {
    return {
      regime:
        "NEUTRO",

      descricao:
        "Amostra insuficiente"
    };
  }

  const streak =
    getStreak(
      colors
    );

  const recent =
    colors.slice(-15);

  const d =
    density(
      recent
    );

  const whiteGap =
    getWhiteGap(
      colors
    );

  const alt =
    alternation(
      recent
    );

  if (
    streak.length >= 4 &&
    streak.color === "V"
  ) {
    return {
      regime:
        "STREAK",

      direcao:
        "V",

      descricao:
        "Sequência prolongada de vermelho"
    };
  }

  if (
    streak.length >= 4 &&
    streak.color === "P"
  ) {
    return {
      regime:
        "STREAK",

      direcao:
        "P",

      descricao:
        "Sequência prolongada de preto"
    };
  }

  if (
    d.V >= 65
  ) {
    return {
      regime:
        "PRESSAO_V",

      direcao:
        "V",

      descricao:
        "Pressão estatística recente para vermelho"
    };
  }

  if (
    d.P >= 65
  ) {
    return {
      regime:
        "PRESSAO_P",

      direcao:
        "P",

      descricao:
        "Pressão estatística recente para preto"
    };
  }

  if (
    whiteGap >= 20
  ) {
    return {
      regime:
        "GAP_BRANCO",

      direcao:
        "B",

      descricao:
        "Longo intervalo desde o último branco"
    };
  }

  if (
    alt >= 7
  ) {
    return {
      regime:
        "ALTERNANCIA",

      descricao:
        "Alta alternância recente"
    };
  }

  return {
    regime:
      "NEUTRO",

    descricao:
      "Sem regime dominante"
  };
}

/*
============================================================
 ESTABILIDADE
============================================================
*/

function calculateStability(
  colors,
  entrada
) {
  if (
    !entrada
  ) {
    return 0;
  }

  const windows = [
    5,
    10,
    20,
    40
  ];

  let total = 0;
  let agree = 0;

  for (
    const size of windows
  ) {
    const sample =
      colors.slice(
        -size
      );

    if (
      sample.length <
      Math.min(
        5,
        size
      )
    ) {
      continue;
    }

    const d =
      density(
        sample
      );

    let suggestion =
      null;

    if (
      entrada === "B"
    ) {
      suggestion =
        d.B >= 10
          ? "B"
          : null;
    } else {
      suggestion =
        d.V >= d.P
          ? "V"
          : "P";
    }

    total++;

    if (
      suggestion ===
      entrada
    ) {
      agree++;
    }
  }

  if (!total) {
    return 0;
  }

  return pct(
    agree,
    total
  );
}

/*
============================================================
 CONSENSO
============================================================
*/

function calculateConsensus(
  strategies,
  back
) {
  const votes = {
    V: 0,
    P: 0,
    B: 0
  };

  const rawVotes = {
    V: 0,
    P: 0,
    B: 0
  };

  let active = 0;

  for (
    const name of Object.keys(
      strategies
    )
  ) {
    const result =
      strategies[name];

    if (
      !result ||
      ![
        "V",
        "P",
        "B"
      ].includes(
        result.entrada
      )
    ) {
      continue;
    }

    const stat =
      back.stats[name];

    const weight =
      stat?.peso ||
      BASE_WEIGHTS[name] ||
      1;

    const score =
      clamp(
        result.score ||
          50,
        0,
        100
      );

    const confidence =
      0.5 +
      score / 200;

    const finalWeight =
      weight *
      confidence;

    votes[
      result.entrada
    ] +=
      finalWeight;

    rawVotes[
      result.entrada
    ]++;

    active++;
  }

  const sorted =
    Object.entries(
      votes
    ).sort(
      (a, b) =>
        b[1] - a[1]
    );

  const winner =
    sorted[0] || [
      null,
      0
    ];

  const second =
    sorted[1] || [
      null,
      0
    ];

  const total =
    Object.values(
      votes
    ).reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    );

  const consensus =
    total
      ? pct(
          winner[1],
          total
        )
      : 0;

  const margin =
    total
      ? pct(
          winner[1] -
            second[1],
          total
        )
      : 0;

  const votePct =
    active
      ? pct(
          rawVotes[
            winner[0]
          ],
          active
        )
      : 0;

  return {
    entrada:
      winner[0],

    consenso:
      consensus,

    margin,

    votePct,

    votos:
      rawVotes,

    pesos:
      votes,

    active,

    votesWinner:
      rawVotes[
        winner[0]
      ] || 0
  };
}

/*
============================================================
 QUALIDADE
============================================================
*/

function calculateQuality(
  consensus,
  stability,
  back,
  entrada
) {
  const statList =
    Object.values(
      back.stats
    );

  const relevant =
    statList.filter(
      stat =>
        stat.testes >= 5
    );

  let backRate = 0;
  let recentRate = 0;

  if (
    relevant.length
  ) {
    backRate =
      relevant.reduce(
        (
          sum,
          stat
        ) =>
          sum +
          stat.taxaAjustada,
        0
      ) /
      relevant.length;

    recentRate =
      relevant.reduce(
        (
          sum,
          stat
        ) =>
          sum +
          stat.recenteTaxa,
        0
      ) /
      relevant.length;
  }

  let quality =
    (
      consensus *
        0.35 +
      stability *
        0.20 +
      backRate *
        0.25 +
      recentRate *
        0.20
    );

  if (
    entrada === "B"
  ) {
    quality -= 5;
  }

  return {
    quality:
      round1(
        clamp(
          quality,
          0,
          100
        )
      ),

    backRate:
      round1(
        backRate
      ),

    recentRate:
      round1(
        recentRate
      )
  };
}

/*
============================================================
 ANÁLISE PRINCIPAL
============================================================
*/

function analyzeColors(
  colors
) {
  const clean =
    Array.isArray(colors)
      ? colors.filter(
          x =>
            x === "V" ||
            x === "P" ||
            x === "B"
        )
      : [];

  if (
    clean.length === 0
  ) {
    return {
      version:
        VERSION,

      signal:
        "NO_SIGNAL",

      entrada:
        null,

      canEnter:
        false,

      history:
        0,

      message:
        "Sem histórico.",

      disclaimer:
        "Radar estatístico baseado em histórico e heurísticas. Não garante o próximo resultado.",

      generatedAt:
        new Date().toISOString()
    };
  }

  const strategies =
    getStrategies(
      clean
    );

  const back =
    backtest(
      clean
    );

  const consensus =
    calculateConsensus(
      strategies,
      back
    );

  const regime =
    detectRegime(
      clean
    );

  const stability =
    calculateStability(
      clean,
      consensus.entrada
    );

  const quality =
    calculateQuality(
      consensus.consenso,
      stability,
      back,
      consensus.entrada
    );

  const blockers = [];

  if (
    clean.length <
    CONFIG.MIN_HISTORY_SIGNAL
  ) {
    blockers.push(
      `Histórico abaixo de ${CONFIG.MIN_HISTORY_SIGNAL} rodadas`
    );
  }

  if (
    consensus.active <
    CONFIG.MIN_ACTIVE_STRATEGIES
  ) {
    blockers.push(
      "Poucas estratégias ativas"
    );
  }

  if (
    consensus.votesWinner <
    CONFIG.MIN_VOTES
  ) {
    blockers.push(
      "Poucos votos"
    );
  }

  if (
    consensus.consenso <
    CONFIG.MIN_CONSENSUS_PCT
  ) {
    blockers.push(
      "Consenso abaixo do mínimo"
    );
  }

  if (
    consensus.votePct <
    CONFIG.MIN_VOTE_PCT
  ) {
    blockers.push(
      "Percentual de votos abaixo do mínimo"
    );
  }

  if (
    consensus.margin <
    CONFIG.MIN_MARGIN_PCT
  ) {
    blockers.push(
      "Margem entre opções muito pequena"
    );
  }

  if (
    stability <
    CONFIG.MIN_STABILITY_PCT
  ) {
    blockers.push(
      "Estabilidade abaixo do mínimo"
    );
  }

  if (
    quality.quality <
    CONFIG.MIN_QUALITY
  ) {
    blockers.push(
      "Qualidade abaixo do mínimo"
    );
  }

  /*
  ----------------------------------------------------------
  BACKTEST MÍNIMO
  ----------------------------------------------------------
  */

  const eligibleStrategies =
    Object.values(
      back.stats
    ).filter(
      stat =>
        stat.testes > 0 &&
        stat.taxa >=
          CONFIG.MIN_BACKTEST_RATE &&
        stat.recenteTaxa >=
          CONFIG.MIN_RECENT_RATE
    );

  if (
    clean.length >=
      CONFIG.MIN_HISTORY_SIGNAL &&
    eligibleStrategies.length ===
      0
  ) {
    blockers.push(
      "Nenhuma estratégia atingiu o backtest mínimo"
    );
  }

  const signal =
    blockers.length === 0
      ? "SIGNAL"
      : "NO_SIGNAL";

  const canEnter =
    signal === "SIGNAL" &&
    [
      "V",
      "P",
      "B"
    ].includes(
      consensus.entrada
    );

  const strategyRows =
    Object.keys(
      strategies
    ).map(
      name => {
        const s =
          strategies[name];

        const stat =
          back.stats[name];

        return {
          estrategia:
            name,

          nome:
            STRATEGY_LABELS[name],

          entrada:
            s?.entrada ||
            null,

          score:
            round1(
              s?.score ||
                0
            ),

          peso:
            round3(
              stat?.peso ||
                BASE_WEIGHTS[
                  name
                ] ||
                1
            ),

          taxa:
            round1(
              stat?.taxa ||
                0
            ),

          recenteTaxa:
            round1(
              stat?.recenteTaxa ||
                0
            ),

          taxaAjustada:
            round1(
              stat?.taxaAjustada ||
                50
            ),

          testes:
            stat?.testes ||
            0
        };
      }
    );

  return {
    version:
      VERSION,

    signal,

    entrada:
      canEnter
        ? consensus.entrada
        : null,

    canEnter,

    disclaimer:
      "Radar estatístico baseado em histórico e heurísticas. Não garante o próximo resultado.",

    history:
      clean.length,

    latest:
      clean[
        clean.length - 1
      ],

    consensus: {
      entrada:
        consensus.entrada,

      consenso:
        consensus.consenso,

      votePct:
        consensus.votePct,

      margin:
        consensus.margin,

      votes:
        consensus.votos,

      active:
        consensus.active,

      votesWinner:
        consensus.votesWinner
    },

    stability:
      round1(
        stability
      ),

    quality:
      quality.quality,

    backtestRate:
      quality.backRate,

    recentRate:
      quality.recentRate,

    regime,

    blockers,

    strongSignal:
      consensus.consenso >=
        CONFIG.STRONG_SIGNAL_CONSENSUS &&
      consensus.votePct >=
        CONFIG.STRONG_SIGNAL_VOTE_PCT &&
      consensus.margin >=
        CONFIG.STRONG_SIGNAL_MARGIN &&
      stability >=
        CONFIG.STRONG_SIGNAL_STABILITY &&
      quality.quality >=
        CONFIG.STRONG_SIGNAL_QUALITY &&
      consensus.votesWinner >=
        CONFIG.STRONG_SIGNAL_MIN_VOTES,

    strategies:
      strategyRows,

    backtest: {
      ranking:
        back.ranking,

      sample:
        back.amostra
    },

    generatedAt:
      new Date().toISOString()
  };
}

/*
============================================================
 PERFORMANCE
============================================================
*/

const PERFORMANCE = {
  total:
    0,

  wins:
    0,

  losses:
    0,

  pushes:
    0,

  history: []
};

function registerResult(
  entry,
  actual
) {
  if (
    !entry ||
    !actual
  ) {
    return null;
  }

  PERFORMANCE.total++;

  let result =
    "LOSS";

  if (
    entry === actual
  ) {
    PERFORMANCE.wins++;

    result =
      "WIN";
  } else {
    PERFORMANCE.losses++;
  }

  const row = {
    entry,
    actual,
    result,

    time:
      new Date().toISOString()
  };

  PERFORMANCE.history.push(
    row
  );

  if (
    PERFORMANCE.history
      .length > 500
  ) {
    PERFORMANCE.history =
      PERFORMANCE.history.slice(
        -500
      );
  }

  return row;
}

function performanceData() {
  const total =
    PERFORMANCE.total;

  return {
    total,

    wins:
      PERFORMANCE.wins,

    losses:
      PERFORMANCE.losses,

    pushes:
      PERFORMANCE.pushes,

    winRate:
      total
        ? pct(
            PERFORMANCE.wins,
            total
          )
        : 0,

    history:
      PERFORMANCE.history
  };
}

/*
============================================================
 BOOK / ESTADO DA RODADA
============================================================
*/

const BOOK = {
  pending: null,

  last: null,

  updatedAt:
    null
};

function bookData() {
  return {
    pending:
      BOOK.pending,

    last:
      BOOK.last,

    updatedAt:
      BOOK.updatedAt
  };
}

/*
============================================================
 IA
============================================================
*/

function getAI() {
  if (
    AI_PROVIDER === "xai" &&
    XAI_API_KEY
  ) {
    return {
      provider:
        "xai",

      key:
        XAI_API_KEY,

      model:
        XAI_MODEL,

      base:
        "https://api.x.ai/v1"
    };
  }

  if (
    GROQ_API_KEY
  ) {
    return {
      provider:
        "groq",

      key:
        GROQ_API_KEY,

      model:
        GROQ_DEFAULT_MODEL,

      base:
        "https://api.groq.com/openai/v1"
    };
  }

  if (
    XAI_API_KEY
  ) {
    return {
      provider:
        "xai",

      key:
        XAI_API_KEY,

      model:
        XAI_MODEL,

      base:
        "https://api.x.ai/v1"
    };
  }

  return null;
}

function aiAvailable() {
  const ai =
    getAI();

  if (!ai) {
    return {
      enabled:
        false,

      provider:
        null,

      model:
        null
    };
  }

  return {
    enabled:
      true,

    provider:
      ai.provider,

    model:
      ai.model
  };
}

async function askAI(
  analysis,
  payload = {}
) {
  const ai =
    getAI();

  if (!ai) {
    return {
      enabled:
        false,

      validated:
        false,

      message:
        "IA não configurada."
    };
  }

  if (
    !analysis ||
    analysis.signal !==
      "SIGNAL"
  ) {
    return {
      enabled:
        true,

      validated:
        false,

      message:
        "A IA não cria sinal quando o radar local não encontrou sinal."
    };
  }

  const modelKey =
    `${ai.provider}:${ai.model}`;

  if (
    MODEL_COOLDOWN.has(
      modelKey
    ) &&
    Date.now() <
      MODEL_COOLDOWN.get(
        modelKey
      )
  ) {
    return {
      enabled:
        true,

      validated:
        false,

      cooldown:
        true,

      message:
        "Modelo temporariamente em cooldown."
    };
  }

  const prompt = `
Você é um validador de um radar estatístico para um jogo de resultados V/P/B.

Não trate o próximo resultado como previsível ou garantido.

Analise apenas se os dados apresentados são coerentes com o sinal estatístico já calculado.

Se houver inconsistência, recomende NÃO ENTRAR.

Não invente dados.

ANÁLISE:

${JSON.stringify(
  analysis,
  null,
  2
)}

HISTÓRICO:

${JSON.stringify(
  payload.colors ||
    [],
  null,
  2
)}

Responda em JSON com:

{
  "valid": true ou false,
  "confidence": número de 0 a 100,
  "reason": "explicação curta"
}
`;

  try {
    const response =
      await postJson(
        `${ai.base}/chat/completions`,

        {
          model:
            ai.model,

          temperature:
            0.1,

          max_tokens:
            250,

          messages: [
            {
              role:
                "system",

              content:
                "Você valida sinais estatísticos. Nunca prometa resultado."
            },

            {
              role:
                "user",

              content:
                prompt
            }
          ]
        },

        {
          Authorization:
            `Bearer ${ai.key}`
        },

        30000
      );

    const content =
      response?.choices?.[0]
        ?.message
        ?.content || "";

    let parsed = null;

    try {
      parsed =
        JSON.parse(
          content
            .replace(
              /```json/gi,
              ""
            )
            .replace(
              /```/g,
              ""
            )
            .trim()
        );
    } catch (_) {
      parsed = {
        valid:
          false,

        confidence:
          0,

        reason:
          content ||
          "Resposta da IA não pôde ser interpretada."
      };
    }

    return {
      enabled:
        true,

      validated:
        Boolean(
          parsed.valid
        ),

      confidence:
        clamp(
          parsed.confidence,
          0,
          100
        ),

      reason:
        parsed.reason ||
        "",

      provider:
        ai.provider,

      model:
        ai.model
    };
  } catch (err) {
    if (
      err.statusCode ===
      429
    ) {
      MODEL_COOLDOWN.set(
        modelKey,
        Date.now() +
          10 * 60 * 1000
      );
    }

    console.log(
      "[AI]",
      err.message
    );

    return {
      enabled:
        true,

      validated:
        false,

      error:
        err.message,

      statusCode:
        err.statusCode ||
        500
    };
  }
}

/*
============================================================
 BODY
============================================================
*/

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
            5 * 1024 * 1024
          ) {
            req.destroy();

            reject(
              new Error(
                "Body muito grande"
              )
            );
          }
        }
      );

      req.on(
        "end",
        () => {
          if (!data) {
            resolve({});
            return;
          }

          try {
            resolve(
              JSON.parse(data)
            );
          } catch (_) {
            reject(
              new Error(
                "JSON inválido"
              )
            );
          }
        }
      );

      req.on(
        "error",
        reject
      );
    }
  );
}

/*
============================================================
 JSON RESPONSE
============================================================
*/

function sendJson(
  res,
  status,
  data
) {
  const body =
    JSON.stringify(
      data
    );

  res.statusCode =
    status;

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

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
    "Content-Type, Authorization"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  res.end(body);
}

/*
============================================================
 STATIC
============================================================
*/

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

  ".ico":
    "image/x-icon",

  ".webmanifest":
    "application/manifest+json"
};

function safeFilePath(
  pathname
) {
  let decoded;

  try {
    decoded =
      decodeURIComponent(
        pathname
      );
  } catch (_) {
    return null;
  }

  if (
    decoded.includes(
      ".."
    )
  ) {
    return null;
  }

  let relative =
    decoded;

  if (
    relative === "/" ||
    relative === ""
  ) {
    relative =
      "/index.html";
  }

  const file =
    path.resolve(
      ROOT,
      "." +
        relative
    );

  const rootResolved =
    path.resolve(
      ROOT
    );

  if (
    file !== rootResolved &&
    !file.startsWith(
      rootResolved +
        path.sep
    )
  ) {
    return null;
  }

  return file;
}

function serveStatic(
  req,
  res,
  pathname
) {
  const file =
    safeFilePath(
      pathname
    );

  if (!file) {
    sendJson(
      res,
      400,
      {
        ok:
          false,

        error:
          "Caminho inválido"
      }
    );

    return;
  }

  fs.stat(
    file,
    (
      err,
      stat
    ) => {
      if (
        err ||
        !stat.isFile()
      ) {
        sendJson(
          res,
          404,
          {
            ok:
              false,

            error:
              "Arquivo não encontrado"
          }
        );

        return;
      }

      const ext =
        path.extname(
          file
        ).toLowerCase();

      res.statusCode =
        200;

      res.setHeader(
        "Content-Type",
        MIME[ext] ||
          "application/octet-stream"
      );

      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

      fs.createReadStream(
        file
      ).pipe(res);
    }
  );
}

/*
============================================================
 SERVER
============================================================
*/

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      try {
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
          "Content-Type, Authorization"
        );

        if (
          req.method ===
          "OPTIONS"
        ) {
          res.statusCode =
            204;

          res.end();

          return;
        }

        const url =
          new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
          );

        const pathname =
          url.pathname;

        /*
        ------------------------------------------------------
        HEALTH
        ------------------------------------------------------
        */

        if (
          pathname ===
          "/health"
        ) {
          sendJson(
            res,
            200,
            {
              ok:
                true,

              status:
                "online",

              version:
                VERSION,

              root:
                path.basename(
                  ROOT
                ),

              port:
                PORT,

              node:
                process.version,

              time:
                new Date().toISOString()
            }
          );

          return;
        }

        /*
        ------------------------------------------------------
        STATUS
        ------------------------------------------------------
        */

        if (
          pathname ===
            "/api/status" &&
          req.method ===
            "GET"
        ) {
          let historyInfo =
            null;

          try {
            const history =
              await getHistory();

            historyInfo = {
              source:
                history.source,

              count:
                history.items.length,

              latest:
                history.items[
                  history.items.length -
                    1
                ] || null
            };
          } catch (err) {
            historyInfo = {
              error:
                err.message
            };
          }

          sendJson(
            res,
            200,
            {
              ok:
                true,

              online:
                true,

              version:
                VERSION,

              port:
                PORT,

              root:
                path.basename(
                  ROOT
                ),

              ai:
                aiAvailable(),

              source:
                sourceStatus,

              history:
                historyInfo,

              performance:
                performanceData(),

              book:
                bookData(),

              time:
                new Date().toISOString()
            }
          );

          return;
        }

        /*
        ------------------------------------------------------
        HISTORY
        ------------------------------------------------------
        */

        if (
          pathname ===
            "/api/history" &&
          req.method ===
            "GET"
        ) {
          try {
            const history =
              await getHistory(
                url.searchParams.get(
                  "force"
                ) ===
                  "1"
              );

            const sorted =
              sortRoundsAscending(
                history.items
              );

            sendJson(
              res,
              200,
              {
                ok:
                  true,

                version:
                  VERSION,

                source:
                  history.source,

                count:
                  sorted.length,

                items:
                  sorted
              }
            );
          } catch (err) {
            sendJson(
              res,
              502,
              {
                ok:
                  false,

                version:
                  VERSION,

                error:
                  err.message,

                source:
                  sourceStatus
              }
            );
          }

          return;
        }

        /*
        ------------------------------------------------------
        LIVE
        ------------------------------------------------------
        */

        if (
          pathname ===
            "/api/live" &&
          req.method ===
            "GET"
        ) {
          try {
            const history =
              await getHistory(
                true
              );

            const sorted =
              sortRoundsAscending(
                history.items
              );

            const colors =
              sorted.map(
                x =>
                  x.color
              );

            const analysis =
              analyzeColors(
                colors
              );

            sendJson(
              res,
              200,
              {
                ok:
                  true,

                version:
                  VERSION,

                source:
                  history.source,

                count:
                  sorted.length,

                latest:
                  sorted[
                    sorted.length -
                      1
                  ] || null,

                analysis,

                items:
                  sorted
              }
            );
          } catch (err) {
            sendJson(
              res,
              502,
              {
                ok:
                  false,

                error:
                  err.message
              }
            );
          }

          return;
        }

        /*
        ------------------------------------------------------
        ANALYZE
        ------------------------------------------------------
        */

        if (
          pathname ===
            "/api/analyze" &&
          req.method ===
            "POST"
        ) {
          const body =
            await readBody(
              req
            );

          let colors =
            Array.isArray(
              body.colors
            )
              ? body.colors
                  .map(
                    normalizeColor
                  )
                  .filter(Boolean)
              : [];

          if (
            colors.length === 0
          ) {
            const history =
              await getHistory(
                true
              );

            colors =
              sortRoundsAscending(
                history.items
              ).map(
                x =>
                  x.color
              );
          }

          const analysis =
            analyzeColors(
              colors
            );

          sendJson(
            res,
            200,
            {
              ok:
                true,

              analysis
            }
          );

          return;
        }

        /*
        ------------------------------------------------------
        AI
        ------------------------------------------------------
        */

        if (
          pathname ===
            "/api/ai" &&
          req.method ===
            "POST"
        ) {
          const body =
            await readBody(
              req
            );

          let colors =
            Array.isArray(
              body.colors
            )
              ? body.colors
                  .map(
                    normalizeColor
                  )
                  .filter(Boolean)
              : [];

          if (
            colors.length === 0
          ) {
            const history =
              await getHistory(
                true
              );

            colors =
              sortRoundsAscending(
                history.items
              ).map(
                x =>
                  x.color
              );
          }

          const analysis =
            analyzeColors(
              colors
            );

          const ai =
            await askAI(
              analysis,
              {
                colors
              }
            );

          let finalAnalysis =
            analysis;

          if (
            analysis.signal !==
              "SIGNAL"
          ) {
            finalAnalysis = {
              ...analysis,

              aiSignal:
                false,

              ai:
                ai
            };
          } else {
            finalAnalysis = {
              ...analysis,

              ai:
                ai,

              aiSignal:
                Boolean(
                  ai.validated
                )
            };
          }

          sendJson(
            res,
            200,
            {
              ok:
                true,

              analysis:
                finalAnalysis,

              ai
            }
          );

          return;
        }

        /*
        ------------------------------------------------------
        PERFORMANCE
        ------------------------------------------------------
        */

        if (
          pathname ===
            "/api/performance" &&
          req.method ===
            "GET"
        ) {
          sendJson(
            res,
            200,
            {
              ok:
                true,

              performance:
                performanceData()
            }
          );

          return;
        }

        /*
        ------------------------------------------------------
        BOOK
        ------------------------------------------------------
        */

        if (
          pathname ===
            "/api/book" &&
          req.method ===
            "GET"
        ) {
          sendJson(
            res,
            200,
            {
              ok:
                true,

              book:
                bookData(),

              performance:
                performanceData()
            }
          );

          return;
        }

        /*
        ------------------------------------------------------
        BOOK UPDATE
        ------------------------------------------------------
        */

        if (
          pathname ===
            "/api/book" &&
          req.method ===
            "POST"
        ) {
          const body =
            await readBody(
              req
            );

          BOOK.pending =
            body.pending ??
            body.entry ??
            null;

          BOOK.last =
            body.last ??
            null;

          BOOK.updatedAt =
            new Date().toISOString();

          sendJson(
            res,
            200,
            {
              ok:
                true,

              book:
                bookData()
            }
          );

          return;
        }

        /*
        ------------------------------------------------------
        RESET
        ------------------------------------------------------
        */

        if (
          pathname ===
            "/api/reset" &&
          req.method ===
            "POST"
        ) {
          PERFORMANCE.total =
            0;

          PERFORMANCE.wins =
            0;

          PERFORMANCE.losses =
            0;

          PERFORMANCE.pushes =
            0;

          PERFORMANCE.history =
            [];

          BOOK.pending =
            null;

          BOOK.last =
            null;

          BOOK.updatedAt =
            new Date().toISOString();

          sendJson(
            res,
            200,
            {
              ok:
                true,

              message:
                "Performance resetada."
            }
          );

          return;
        }

        /*
        ------------------------------------------------------
        SOURCE TEST
        ------------------------------------------------------
        */

        if (
          pathname ===
            "/api/source-test" &&
          req.method ===
            "GET"
        ) {
          const result = {
            ok:
              false,

            source:
              null,

            count:
              0,

            error:
              null
          };

          try {
            const history =
              await getHistory(
                true
              );

            result.ok =
              true;

            result.source =
              history.source;

            result.count =
              history.items.length;
          } catch (err) {
            result.error =
              err.message;
          }

          sendJson(
            res,
            result.ok
              ? 200
              : 502,
            result
          );

          return;
        }

        /*
        ------------------------------------------------------
        STATIC
        ------------------------------------------------------
        */

        if (
          req.method ===
          "GET"
        ) {
          serveStatic(
            req,
            res,
            pathname
          );

          return;
        }

        sendJson(
          res,
          404,
          {
            ok:
              false,

            error:
              "Rota não encontrada"
          }
        );
      } catch (err) {
        console.error(
          "[SERVER ERROR]",
          err
        );

        sendJson(
          res,
          500,
          {
            ok:
              false,

            error:
              err.message ||
              "Erro interno"
          }
        );
      }
    }
  );

/*
============================================================
 START
============================================================
*/

server.listen(
  PORT,
  HOST,
  () => {
    console.log(
      "================================================="
    );

    console.log(
      " RIFT DOUBLE RADAR ONLINE"
    );

    console.log(
      ` Versão: ${VERSION}`
    );

    console.log(
      ` Porta: ${PORT}`
    );

    console.log(
      ` Host: ${HOST}`
    );

    console.log(
      ` ROOT: ${ROOT}`
    );

    console.log(
      ` Node: ${process.version}`
    );

    console.log(
      "================================================="
    );

    console.log(
      "API:"
    );

    console.log(
      "  /health"
    );

    console.log(
      "  /api/status"
    );

    console.log(
      "  /api/history"
    );

    console.log(
      "  /api/live"
    );

    console.log(
      "  /api/analyze"
    );

    console.log(
      "  /api/ai"
    );

    console.log(
      "  /api/performance"
    );

    console.log(
      "  /api/book"
    );

    console.log(
      "  /api/reset"
    );

    console.log(
      "  /api/source-test"
    );

    console.log(
      "================================================="
    );
  }
);

/*
============================================================
 ERROS GLOBAIS
============================================================
*/

process.on(
  "uncaughtException",
  err => {
    console.error(
      "[uncaughtException]",
      err
    );
  }
);

process.on(
  "unhandledRejection",
  err => {
    console.error(
      "[unhandledRejection]",
      err
    );
  }
);