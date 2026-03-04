const crypto = require("crypto");

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// ユーザーごとの会話状態を保持（本番ではRedis等に置き換え）
const userSessions = {};

// 車種マスタデータ
const CAR_DATA = {
  トヨタ: {
    models: ["プリウス", "アクア", "ヤリス", "カローラ", "ハリアー", "RAV4", "アルファード", "ノア", "ヴォクシー", "その他"],
  },
  ホンダ: {
    models: ["フィット", "ヴェゼル", "CR-V", "シビック", "フリード", "ステップワゴン", "N-BOX", "その他"],
  },
  日産: {
    models: ["ノート", "リーフ", "キックス", "エクストレイル", "セレナ", "デイズ", "その他"],
  },
  マツダ: {
    models: ["MAZDA3", "CX-3", "CX-5", "CX-30", "CX-8", "ロードスター", "その他"],
  },
  スバル: {
    models: ["インプレッサ", "レヴォーグ", "フォレスター", "アウトバック", "XV", "その他"],
  },
  スズキ: {
    models: ["アルト", "ワゴンR", "スペーシア", "ハスラー", "ジムニー", "クロスビー", "その他"],
  },
  ダイハツ: {
    models: ["ミラ", "ムーヴ", "タント", "ロッキー", "その他"],
  },
  BMW: {
    models: ["3シリーズ", "5シリーズ", "X3", "X5", "iX", "その他"],
  },
  "Mercedes-Benz": {
    models: ["Cクラス", "Eクラス", "GLC", "GLE", "EQC", "その他"],
  },
  Volkswagen: {
    models: ["ゴルフ", "ポロ", "ティグアン", "パサート", "ID.4", "その他"],
  },
  Audi: {
    models: ["A3", "A4", "Q3", "Q5", "e-tron", "その他"],
  },
  Tesla: {
    models: ["Model 3", "Model Y", "Model S", "Model X", "その他"],
  },
};

// LINEにメッセージを送信
async function replyMessage(replyToken, messages) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("LINE API error:", err);
  }
}

// ボタンテンプレートを生成
function makeButtonsMessage(text, actions) {
  // actionsを4個以内に分割してカルーセルにする
  const chunks = [];
  for (let i = 0; i < actions.length; i += 3) {
    chunks.push(actions.slice(i, i + 3));
  }

  if (chunks.length === 1) {
    return {
      type: "template",
      altText: text,
      template: {
        type: "buttons",
        text: text.length > 160 ? text.slice(0, 157) + "..." : text,
        actions: chunks[0].map((label) => ({
          type: "postback",
          label: label,
          data: label,
          displayText: label,
        })),
      },
    };
  }

  // カルーセルは全列のボタン数を3個に統一する必要がある
  const normalizedChunks = chunks.map((chunk) => {
    const padded = [...chunk];
    while (padded.length < 3) padded.push("－");
    return padded;
  });

  return {
    type: "template",
    altText: text,
    template: {
      type: "carousel",
      columns: normalizedChunks.map((chunk, i) => ({
        text: i === 0 ? (text.length > 60 ? text.slice(0, 57) + "..." : text) : "続きの選択肢",
        actions: chunk.map((label) => ({
          type: "postback",
          label: label,
          data: label,
          displayText: label,
        })),
      })),
    },
  };
}

// テキストメッセージ生成
function makeTextMessage(text) {
  return { type: "text", text };
}

// 各ステップのハンドラー
async function handleStep(userId, replyToken, input, session) {
  const step = session.step;

  if (step === "start") {
    session.step = "maker";
    await replyMessage(replyToken, [
      makeTextMessage("中古車の概算査定を始めます！\nタップだけで答えられるので、だいたい1〜2分で完了します😊"),
      makeButtonsMessage("【1/4】 車のメーカーを教えてください", Object.keys(CAR_DATA)),
    ]);
  } else if (step === "maker") {
    if (!CAR_DATA[input]) {
      await replyMessage(replyToken, [makeTextMessage("メーカーをボタンから選んでください👆")]);
      return;
    }
    session.maker = input;
    session.step = "model";
    const models = CAR_DATA[input].models;
    await replyMessage(replyToken, [
      makeButtonsMessage("【2/4】 車種を教えてください", models),
    ]);
  } else if (step === "model") {
    session.model = input;
    session.step = "year";
    await replyMessage(replyToken, [
      makeButtonsMessage("【3/4】 購入したのはいつごろですか？\n（だいたいで大丈夫です）", [
        "3年以内",
        "3〜7年前",
        "7〜10年前",
        "10年以上前",
      ]),
    ]);
  } else if (step === "year") {
    session.year = input;
    session.step = "mileage";
    await replyMessage(replyToken, [
      makeButtonsMessage("【4/4】 走行距離はだいたいどのくらいですか？\n（メーターで確認できます）", [
        "〜3万km",
        "3〜7万km",
        "7〜10万km",
        "10万km以上",
        "わからない",
      ]),
    ]);
  } else if (step === "mileage") {
    session.mileage = input;
    session.step = "condition";
    await replyMessage(replyToken, [
      makeButtonsMessage("最後に、目立つキズや凹みはありますか？", [
        "ほとんどない",
        "少しある",
        "けっこうある",
      ]),
    ]);
  } else if (step === "condition") {
    session.condition = input;
    session.step = "photo";

    const summary =
      "📋 入力内容の確認\n" +
      "─────────────\n" +
      `メーカー：${session.maker}\n` +
      `車種：${session.model}\n` +
      `購入時期：${session.year}\n` +
      `走行距離：${session.mileage}\n` +
      `車の状態：${session.condition}\n` +
      "─────────────";

    const photoUrls = [
      "https://i.imgur.com/ayPZ6am.jpg",
      "https://i.imgur.com/Sepquwp.jpg",
      "https://i.imgur.com/RyER1c5.jpg",
    ];
    const photoMessages = photoUrls.map((url) => ({
      type: "image",
      originalContentUrl: url,
      previewImageUrl: url,
    }));

    await replyMessage(replyToken, [
      makeTextMessage(summary),
      makeTextMessage(
        "ありがとうございます！\n\nより正確な査定のため、お車の写真を送っていただけますか？📸\n\n" +
          "【撮影してほしい箇所】\n" +
          "① 正面（フロント）\n" +
          "② 側面（ドライバー側）\n" +
          "③ メーター（走行距離が見えるように）\n\n" +
          "※ 写真なしでも査定できます。スキップする場合は「スキップ」と送ってください。"
      ),
      ...photoMessages,
    ]);
  } else if (step === "photo") {
    const hasPhoto = session.hasPhoto;

    await replyMessage(replyToken, [
      makeTextMessage(
        (hasPhoto ? "写真もありがとうございます！📸\n\n" : "") +
          "✅ 査定依頼を受け付けました！\n\n" +
          "スタッフが内容を確認のうえ、概算金額を\n営業時間内（09:00〜17:30）に\nこちらのトークにお送りします。\n\n" +
          "今しばらくお待ちください😊"
      ),
    ]);

    userSessions[userId] = { step: "start" };
  }
}

// Webhook署名検証
function verifySignature(body, signature) {
  if (!CHANNEL_SECRET) return true; // 環境変数未設定時はスキップ（開発時のみ）
  const hash = crypto.createHmac("SHA256", CHANNEL_SECRET).update(body).digest("base64");
  return hash === signature;
}

// メインのWebhookハンドラー
module.exports = async (req, res) => {
  // 環境変数チェック
  if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
    console.error("環境変数が設定されていません:", {
      CHANNEL_SECRET: !!CHANNEL_SECRET,
      CHANNEL_ACCESS_TOKEN: !!CHANNEL_ACCESS_TOKEN,
    });
    return res.status(200).send("ENV ERROR - check logs");
  }

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  // 署名検証
  const signature = req.headers["x-line-signature"];
  const rawBody = JSON.stringify(req.body);
  if (!verifySignature(rawBody, signature)) {
    return res.status(401).send("Unauthorized");
  }

  const events = req.body.events || [];

  for (const event of events) {
    const userId = event.source?.userId;
    if (!userId) continue;

    // セッション初期化
    if (!userSessions[userId]) {
      userSessions[userId] = { step: "start" };
    }
    const session = userSessions[userId];

    if (event.type === "follow") {
      // 友だち追加時
      session.step = "start";
      await handleStep(userId, event.replyToken, null, session);
    } else if (event.type === "postback") {
      // ボタンタップ時
      const data = event.postback?.data;
      await handleStep(userId, event.replyToken, data, session);
    } else if (event.type === "message") {
      if (event.message.type === "image") {
        // 写真受信
        session.hasPhoto = true;
        if (session.step === "photo") {
          await handleStep(userId, event.replyToken, null, session);
        }
      } else if (event.message.type === "text") {
        const text = event.message.text;

        if (text === "査定" || text === "査定する" || text === "スタート" || text.includes("査定をしたい") || text.includes("査定したい")) {
          session.step = "start";
          await handleStep(userId, event.replyToken, null, session);
        } else if (session.step === "photo" && text.includes("スキップ")) {
          await handleStep(userId, event.replyToken, null, session);
        } else if (session.step === "start") {
          await handleStep(userId, event.replyToken, null, session);
        } else {
          await replyMessage(replyToken, [
            makeTextMessage("ボタンから選んでください👆\n\n最初からやり直す場合は「査定」と送ってください。"),
          ]);
        }
      }
    }
  }

  res.status(200).send("OK");
};
