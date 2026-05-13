import https from "https";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const RELAYERS_PER_PAGE = 10;

function urlWithParams(baseUrl, params) {
  const u = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: "GET", headers },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function fetchPostJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(bodyStr, "utf8"),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(bodyStr, "utf8");
    req.end();
  });
}

export const handler = async () => {
  const cloudwatch = new CloudWatchClient({});
  const ssm = new SSMClient({});

  const BALANCE_URL = process.env.BALANCE_URL;
  const RELAYERS_URL = process.env.RELAYERS_URL;
  const PLUGINS_CALL_URL = process.env.PLUGINS_CALL_URL;
  const RELAYER_API_KEY_NAME = process.env.CHANNELS_API_KEY_PARAMETER;
  const ADMIN_SECRET_PARAMETER = process.env.CHANNELS_ADMIN_SECRET_PARAMETER;
  const ENVIRONMENT_NAME = process.env.ENVIRONMENT || "default";
  const EXTRA_BALANCE_URLS = process.env.EXTRA_BALANCE_URLS;

  // 1 XLM = 10,000,000 stroops
  const STROOPS_PER_XLM = 10_000_000;

  if (!BALANCE_URL || !RELAYERS_URL || !RELAYER_API_KEY_NAME) {
    throw new Error("Missing BALANCE_URL, RELAYERS_URL, or CHANNELS_API_KEY_PARAMETER env var");
  }
  if (!PLUGINS_CALL_URL || !ADMIN_SECRET_PARAMETER) {
    throw new Error("Missing PLUGINS_CALL_URL or CHANNELS_ADMIN_SECRET_PARAMETER env var");
  }

  try {
    const [apiKeyParam, adminSecretParam] = await Promise.all([
      ssm.send(new GetParameterCommand({ Name: RELAYER_API_KEY_NAME, WithDecryption: true })),
      ssm.send(new GetParameterCommand({ Name: ADMIN_SECRET_PARAMETER, WithDecryption: true })),
    ]);

    const bearerToken = apiKeyParam.Parameter.Value;
    const adminSecret = adminSecretParam.Parameter.Value;

    const headers = {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    };

    const resp = await fetchJson(BALANCE_URL, headers);

    if (!resp.success) {
      throw new Error(`API returned error: ${JSON.stringify(resp.error)}`);
    }

    const balance = resp.data?.balance;
    const unit = resp.data?.unit;

    if (typeof balance !== "number") {
      throw new Error(`Unexpected balance payload: ${JSON.stringify(resp.data)}`);
    }

    const balanceXLM = balance / STROOPS_PER_XLM;

    let totalRelayers = 0;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const pageUrl = urlWithParams(RELAYERS_URL, { page, limit: RELAYERS_PER_PAGE });
      const relayersResp = await fetchJson(pageUrl, headers);

      if (!relayersResp.success) {
        throw new Error(`Relayers API returned error: ${JSON.stringify(relayersResp.error)}`);
      }

      const data = relayersResp.data;
      let items;
      if (Array.isArray(data)) {
        items = data;
      } else if (Array.isArray(data?.relayers)) {
        items = data.relayers;
      } else {
        throw new Error(`Unexpected relayers payload: ${JSON.stringify(data)}`);
      }

      totalRelayers += items.length;
      hasMore = items.length >= RELAYERS_PER_PAGE;
      page += 1;
    }

    const metricData = [
      {
        MetricName: "RelayerBalanceXLM",
        Dimensions: [
          { Name: "Relayer", Value: "channels-fund" },
          { Name: "Environment", Value: ENVIRONMENT_NAME },
        ],
        Value: balanceXLM,
        Unit: "Count",
      },
      {
        MetricName: "TotalRelayers",
        Dimensions: [{ Name: "Environment", Value: ENVIRONMENT_NAME }],
        Value: totalRelayers,
        Unit: "Count",
      },
    ];

    // Check additional relayer balances
    if (EXTRA_BALANCE_URLS) {
      for (const entry of EXTRA_BALANCE_URLS.split(",")) {
        const eqIdx = entry.indexOf("=");
        if (eqIdx < 1) continue;
        const relayerId = entry.slice(0, eqIdx).trim();
        const balanceUrl = entry.slice(eqIdx + 1).trim();
        if (!relayerId || !balanceUrl) continue;

        try {
          const extraResp = await fetchJson(balanceUrl, headers);
          if (extraResp.success && typeof extraResp.data?.balance === "number") {
            const extraXLM = extraResp.data.balance / STROOPS_PER_XLM;
            metricData.push({
              MetricName: "RelayerBalanceXLM",
              Dimensions: [
                { Name: "Relayer", Value: relayerId },
                { Name: "Environment", Value: ENVIRONMENT_NAME },
              ],
              Value: extraXLM,
              Unit: "Count",
            });
            console.log(`Extra balance for ${relayerId}: ${extraResp.data.balance} stroops (~${extraXLM} XLM)`);
          } else {
            console.warn(`Failed to fetch balance for ${relayerId}: ${JSON.stringify(extraResp)}`);
          }
        } catch (err) {
          console.warn(`Error fetching balance for ${relayerId}: ${err.message}`);
        }
      }
    }

    // Plugins channels/call stats (non-fatal)
    try {
      const pluginsBody = {
        params: {
          management: {
            action: "stats",
            adminSecret,
          },
        },
      };
      const pluginsResp = await fetchPostJson(PLUGINS_CALL_URL, headers, pluginsBody);

      if (!pluginsResp.success) {
        console.warn(`Plugins stats API returned error (non-fatal): ${JSON.stringify(pluginsResp.error)}`);
      } else {
        const pool = pluginsResp.data?.pool;
        if (pool && typeof pool.available === "number" && typeof pool.locked === "number" && typeof pool.size === "number") {
          const envDim = { Name: "Environment", Value: ENVIRONMENT_NAME };
          metricData.push(
            { MetricName: "PoolAvailable", Dimensions: [envDim], Value: pool.available, Unit: "Count" },
            { MetricName: "PoolLocked", Dimensions: [envDim], Value: pool.locked, Unit: "Count" },
            { MetricName: "PoolSize", Dimensions: [envDim], Value: pool.size, Unit: "Count" },
          );
        } else {
          console.warn(`Unexpected plugins stats payload (non-fatal): ${JSON.stringify(pluginsResp.data)}`);
        }
      }
    } catch (pluginErr) {
      console.warn(`Plugin stats call failed (non-fatal): ${pluginErr.message}`);
    }

    const cmd = new PutMetricDataCommand({
      Namespace: "Channels/Relayers/Balance",
      MetricData: metricData,
    });

    await cloudwatch.send(cmd);

    const poolAvail = metricData.find((m) => m.MetricName === "PoolAvailable");
    const poolLocked = metricData.find((m) => m.MetricName === "PoolLocked");
    const poolSize = metricData.find((m) => m.MetricName === "PoolSize");
    const poolSummary =
      poolAvail && poolLocked && poolSize
        ? `, pool: available=${poolAvail.Value} locked=${poolLocked.Value} size=${poolSize.Value}`
        : "";

    console.log(
      `Published balance metrics: ${balance} ${unit} (~${balanceXLM} XLM), total relayers: ${totalRelayers}${poolSummary}`,
    );

    return {
      balance,
      balanceXLM,
      unit,
      totalRelayers,
      pool: poolAvail ? { available: poolAvail.Value, locked: poolLocked.Value, size: poolSize.Value } : null,
    };
  } catch (error) {
    console.error(`Error checking relayer balance: ${error.message}`);
    throw error;
  }
};
