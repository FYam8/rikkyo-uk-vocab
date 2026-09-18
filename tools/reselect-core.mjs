import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const BASELINE_COMMIT = "132dfa1721f2032e8acf59ca163664efe60ae9dc";
const OCR_KEYS = ["01", "02", "07", "08", "13", "14"];
const OCR_META = {
  "01": [2024, "A"], "02": [2024, "B"], "07": [2025, "A"],
  "08": [2025, "B"], "13": [2026, "A"], "14": [2026, "B"],
};

// Paper-glossed words, common directions, duplicated boilerplate and elementary
// vocabulary are not allowed to dominate the entrance-exam learning queue.
const EXCLUDE = new Set([
  "afternoon", "animal", "anything", "apple", "ask", "away", "baby", "back", "bad", "bed", "bedroom", "big", "bird", "book", "boy", "brother", "buy", "call", "car", "cat", "chair", "clean", "coffee", "come", "cook", "country", "cry", "cut", "day", "dinner", "door", "eat", "example", "father", "feed", "female", "find", "finish", "flower", "fly", "food", "football", "friend", "full", "game", "garden", "get", "girl", "go", "good", "grandfather", "great", "grow", "gym", "hand", "happy", "hear", "help", "home", "hour", "house", "idea", "jump", "kid", "know", "last", "laugh", "learn", "library", "like", "little", "live", "look", "love", "make", "man", "money", "morning", "mother", "mountain", "move", "mum", "name", "need", "new", "news", "next", "night", "noon", "old", "open", "parent", "party", "path", "people", "phone", "picture", "piece", "plant", "player", "put", "read", "robin", "room", "rose", "run", "sad", "say", "school", "see", "sell", "shop", "sit", "sleep", "small", "someone", "something", "sorry", "speak", "stand", "start", "station", "stop", "story", "student", "summer", "table", "take", "talk", "tall", "tell", "thank", "thanks", "thing", "think", "time", "tomorrow", "town", "tree", "use", "village", "visit", "wait", "walk", "want", "watch", "water", "week", "window", "word", "work", "world", "write", "year", "yesterday", "young",
  "day in and day out", "get rid of", "get stuck", "once upon a time",
  // Phase 24: elementary items, sense-mismatched OCR hits and redundant
  // derivatives. These IDs stay in the registry/history, but not the queue.
  "able", "alive", "anymore", "arrive", "body", "borrow", "bring", "building", "care", "carry", "club", "correct", "course", "dead", "die", "different", "difficult", "doctor", "early", "else", "enjoy", "enough", "everything", "famous", "feel", "finally", "forget", "free", "front", "future", "glad", "ground", "happen", "healthy", "inside", "interested", "kindness", "listen", "long", "lot", "lovely", "lucky", "month", "often", "outside", "pleased", "present", "problem", "quickly", "quietly", "really", "repair", "return", "shoulder", "slowly", "sometimes", "somewhere", "soon", "stay", "strong", "study", "suddenly", "surprised", "teach", "together", "toward", "understand", "until", "voice", "warm", "wear", "weather", "well", "writer",
  "recording", "recycling", "industrial", "revolution", "local community",
  "angry", "at first", "be afraid of", "catch a cold", "come from", "for example",
  "help with", "in the past", "sick", "size",
]);
const SOURCE_EXAMPLE_EXCLUDE = new Set([
  "allow", "catch", "choose", "close", "energy", "follow", "for example",
  "in order to", "leave", "miss", "order", "sometimes", "source", "support", "up to",
]);

// OCR can join headings, adjacent dialogue, and answer choices to otherwise
// valid sentences. Keep the authentic wording while presenting one complete,
// learner-facing sentence from the cited page.
const SOURCE_SENTENCE_OVERRIDES = {
  ability: "One morning you wake up and discover that you have a new ability (for example: you can fly, you can speak to animals, you can become invisible, or another power).",
  believe: "But you did not believe me.",
  creative: "Join us on Saturday from 9:00am to 12 noon in Room 5 for a workshop on creative writing.",
  deliver: "Next morning Helen saw John delivering letters to her neighbours.",
  discover: "One morning you wake up and discover that you have a new ability (for example: you can fly, you can speak to animals, you can become invisible, or another power).",
  "even if": "Even if I repair it, I can't use it.",
  hope: "Our only hope is to play dead when that hunter comes back tomorrow.",
  imagine: "Imagine that one morning you find a mysterious door in your school that you've never seen before.",
  invisible: "One morning you wake up and discover that you have a new ability (for example: you can fly, you can speak to animals, you can become invisible, or another power).",
  join: "Join us on Saturday from 9:00am to 12 noon in Room 5 for a workshop on creative writing.",
  mysterious: "Imagine that one morning you find a mysterious door in your school that you've never seen before.",
  power: "One morning you wake up and discover that you have a new ability (for example: you can fly, you can speak to animals, you can become invisible, or another power).",
  since: "I have wanted to have a dog since I was a little girl.",
  though: "Though she was not sure, she followed her mother's instructions and planted the stem in the garden and then watered it.",
  usually: "Usually, most female robins fly to warm countries before winter.",
};

const MANUAL = [
  ["photosynthesis", "光合成", "noun", "Challenge"],
  ["retention", "保持、維持", "noun", "Challenge"],
  ["nutrient", "栄養素", "noun", "Challenge"],
  ["recyclable", "リサイクル可能な", "adjective", "Challenge"],
  ["wildlife", "野生生物", "noun", "Core"],
  ["mammal", "哺乳類", "noun", "Core"],
  ["electricity", "電気", "noun", "Core"],
  ["biology", "生物学", "noun", "Core"],
  ["practical", "実用的な、実践的な", "adjective", "Core"],
  ["document", "文書、資料", "noun", "Core"],
  ["source", "情報源、資料", "noun", "Core"],
  ["tourist", "観光客", "noun", "Core"],
  ["recycling", "リサイクル", "noun", "Core"],
  ["photograph", "写真", "noun", "Core"],
  ["challenge", "課題、難題", "noun", "Core"],
  ["rubbish", "ごみ", "noun", "Core"],
  ["sample", "試料、サンプル", "noun", "Core"],
  ["industrial", "工業の、産業の", "adjective", "Challenge"],
  ["revolution", "革命", "noun", "Challenge"],
  ["presentation", "発表、プレゼンテーション", "noun", "Core"],
  ["measure", "測定する、測る", "verb", "Core"],
  ["material", "材料、物質", "noun", "Core"],
  ["amount", "量、総量", "noun", "Core"],
  ["absorb", "吸収する", "verb", "Challenge"],
  ["release", "放出する、解放する", "verb", "Challenge"],
  ["process", "過程、処理する", "noun/verb", "Core"],
  ["compare", "比較する", "verb", "Core"],
  ["reduce", "減らす、削減する", "verb", "Core"],
  ["waste", "廃棄物、無駄", "noun", "Core"],
  ["growth", "成長、増加", "noun", "Core"],
  ["organism", "生物、有機体", "noun", "Challenge"],
  ["environmental", "環境の、環境に関する", "adjective", "Challenge"],
  ["collection", "収集、集めたもの", "noun", "Core"],
  ["recording", "記録、録音", "noun", "Core"],
  ["local community", "地域社会", "phrase", "Core"],
  ["climate change", "気候変動", "phrase", "Challenge"],
  ["Industrial Revolution", "産業革命", "proper noun", "Challenge"],
];

// Difficulty is lexical difficulty, not Waseda's target-score field.  The
// Foundation set is deliberately small and contains grammar/reading anchors.
const FOUNDATION_KEEP = new Set([
  "afraid", "agree", "begin", "believe", "cost", "even if", "even though",
  "human", "important", "in order to", "instead", "invite", "join", "local",
  "memory", "mistake", "notice", "order", "poor", "prepare", "reach", "result",
  "seem", "solve", "spend", "suggest", "trouble", "up to", "usually", "yet",
]);
const CHALLENGE_KEEP = new Set(["influence", "investigate"]);

// Rikkyo-themed transfer vocabulary.  Every item is useful without audio and
// is tagged by lexical difficulty independently of occurrence or score band.
const TRANSFER = [
  // Core transfer and task language
  ["ability", "能力", "noun", "Core", "The task asks you to imagine a new ability.", "その課題では新しい能力を想像するよう求めています。"],
  ["available", "利用できる、都合がつく", "adjective", "Core", "The new books are available in the reading section.", "新しい本は閲覧コーナーで利用できます。"],
  ["participate", "参加する", "verb", "Core", "Students can participate in the park clean-up.", "生徒は公園の清掃活動に参加できます。"],
  ["suitable", "適した", "adjective", "Core", "The workshop is suitable for students who enjoy writing.", "その講座は作文を楽しむ生徒に適しています。"],
  ["provide", "提供する", "verb", "Core", "The school provides equipment for the experiment.", "学校は実験用の器具を提供します。"],
  ["improve", "改善する、上達させる", "verb", "Core", "Regular practice can improve your writing.", "定期的な練習で作文力を向上させられます。"],
  ["develop", "発達させる、開発する", "verb", "Core", "The project helped students develop research skills.", "その活動は生徒が調査技能を伸ばす助けになりました。"],
  ["require", "必要とする、要求する", "verb", "Core", "The experiment requires three different materials.", "その実験には3種類の材料が必要です。"],
  ["include", "含む", "verb", "Core", "The report should include evidence from the experiment.", "報告書には実験の証拠を含めるべきです。"],
  ["increase", "増加する、増やす", "verb", "Core", "More light may increase plant growth.", "光を増やすと植物の成長が促される場合があります。"],
  ["decrease", "減少する、減らす", "verb", "Core", "The amount of waste decreased after the campaign.", "活動後に廃棄物の量が減少しました。"],
  ["create", "作り出す", "verb", "Core", "The class created a poster for the exhibition.", "クラスは展示会用のポスターを作りました。"],
  ["organise", "計画・整理する", "verb", "Core", "Students organised the results in a table.", "生徒たちは結果を表に整理しました。"],
  ["communicate", "伝える、意思疎通する", "verb", "Core", "A clear graph communicates the result quickly.", "明確なグラフは結果をすばやく伝えます。"],
  ["community", "地域社会、共同体", "noun", "Core", "The local community supported the clean-up.", "地域社会が清掃活動を支援しました。"],
  ["behaviour", "行動、振る舞い", "noun", "Core", "The students observed the birds' behaviour.", "生徒たちは鳥の行動を観察しました。"],
  ["purpose", "目的", "noun", "Core", "The purpose of the experiment was to test plant growth.", "実験の目的は植物の成長を調べることでした。"],
  ["advantage", "利点", "noun", "Core", "One advantage of recycling is reduced waste.", "リサイクルの利点の一つは廃棄物を減らせることです。"],
  ["disadvantage", "欠点、不利な点", "noun", "Core", "The report also explains one disadvantage.", "報告書は欠点も一つ説明しています。"],
  ["opportunity", "機会", "noun", "Core", "The workshop gives students an opportunity to practise.", "その講座は生徒に練習の機会を与えます。"],
  ["responsibility", "責任", "noun", "Core", "Protecting wildlife is a shared responsibility.", "野生生物を守ることは共通の責任です。"],
  ["instruction", "指示、説明", "noun", "Core", "Read each instruction before answering.", "解答前に各指示を読みなさい。"],
  ["survey", "調査、アンケート", "noun", "Core", "The students carried out a survey about transport.", "生徒たちは交通について調査を行いました。"],
  ["report", "報告書／報告する", "noun/verb", "Core", "The group wrote a report on climate change.", "グループは気候変動について報告書を書きました。"],
  ["decision", "決定、判断", "noun", "Core", "Her decision changed the result of the story.", "彼女の決断が物語の結末を変えました。"],
  ["adventure", "冒険", "noun", "Core", "The mysterious door began an unexpected adventure.", "不思議な扉から予想外の冒険が始まりました。"],
  ["century", "世紀", "noun", "Core", "The invention changed life in the nineteenth century.", "その発明は19世紀の生活を変えました。"],
  ["society", "社会", "noun", "Core", "New technology can change society.", "新しい技術は社会を変えることがあります。"],
  ["factory", "工場", "noun", "Core", "Factories produced goods more quickly.", "工場は製品をより速く生産しました。"],
  ["transport", "交通、輸送", "noun", "Core", "Railways transformed transport during the period.", "鉄道はその時代の交通を変えました。"],
  ["oxygen", "酸素", "noun", "Core", "Plants release oxygen during photosynthesis.", "植物は光合成で酸素を放出します。"],
  ["temperature", "温度", "noun", "Core", "The class measured the temperature every hour.", "クラスは毎時間温度を測定しました。"],
  ["surface", "表面", "noun", "Core", "Water remained on the surface of the clay.", "水は粘土の表面に残りました。"],
  ["liquid", "液体", "noun/adjective", "Core", "The students measured the liquid carefully.", "生徒たちは液体を注意深く測りました。"],
  ["root", "根、根本", "noun", "Core", "Plant roots absorb water from the soil.", "植物の根は土から水を吸収します。"],
  ["sunlight", "日光", "noun", "Core", "The plant in sunlight grew tall and green.", "日光の下の植物は高く緑色に育ちました。"],
  ["clay", "粘土", "noun", "Core", "The plants in clay remained small.", "粘土の植物は小さいままでした。"],
  ["microscope", "顕微鏡", "noun", "Core", "They examined the sample under a microscope.", "彼らは顕微鏡で試料を調べました。"],
  ["control", "制御する／対照", "verb/noun", "Core", "The experiment used one plant as a control.", "その実験では植物一つを対照として使いました。"],
  ["calculate", "計算する", "verb", "Core", "Calculate the average growth of the plants.", "植物の平均成長量を計算しなさい。"],
  ["classify", "分類する", "verb", "Core", "Classify the materials into three groups.", "材料を3つの群に分類しなさい。"],
  ["examine", "詳しく調べる", "verb", "Core", "The students examined each soil sample.", "生徒たちは各土壌試料を詳しく調べました。"],
  ["observe", "観察する", "verb", "Core", "Observe how the plant changes over one week.", "1週間で植物がどう変化するか観察しなさい。"],
  ["predict", "予測する", "verb", "Core", "Predict which plant will grow fastest.", "どの植物が最も速く育つか予測しなさい。"],
  ["assignment", "課題、宿題", "noun", "Core", "The history assignment is due on Monday.", "歴史の課題は月曜日が提出期限です。"],
  ["deadline", "締切", "noun", "Core", "The group finished the slides before the deadline.", "グループは締切前にスライドを完成させました。"],
  ["laboratory", "実験室", "noun", "Core", "The class met in the science laboratory.", "クラスは理科実験室に集まりました。"],
  ["accurate", "正確な", "adjective", "Core", "Accurate measurements make the result reliable.", "正確な測定は結果の信頼性を高めます。"],
  ["alternative", "代わりのもの、別の選択肢", "noun/adjective", "Core", "The group considered an alternative method.", "グループは別の方法を検討しました。"],
  ["approach", "方法、取り組み方", "noun", "Core", "The two groups used a different approach.", "2つのグループは異なる取り組み方を使いました。"],
  ["benefit", "利益、恩恵／役立つ", "noun/verb", "Core", "Recycling provides a benefit to the community.", "リサイクルは地域社会に恩恵をもたらします。"],
  ["cause", "原因／引き起こす", "noun/verb", "Core", "The class discussed the cause of the change.", "クラスは変化の原因を話し合いました。"],
  ["effect", "影響、効果", "noun", "Core", "The experiment measured the effect of light.", "その実験は光の影響を測定しました。"],
  ["relationship", "関係、関連", "noun", "Core", "The graph shows a relationship between light and growth.", "グラフは光と成長の関係を示しています。"],
  ["pattern", "型、傾向", "noun", "Core", "A clear pattern appeared in the results.", "結果に明確な傾向が現れました。"],
  ["trend", "傾向", "noun", "Core", "The data showed an upward trend.", "データは上昇傾向を示しました。"],
  ["gradual", "徐々の、段階的な", "adjective", "Core", "The plants showed gradual growth.", "植物は徐々に成長しました。"],
  ["immediate", "即座の、直接の", "adjective", "Core", "There was no immediate change in the plant.", "植物にはすぐには変化がありませんでした。"],

  // Challenge transfer: science, environment, history and narrative writing
  ["biodiversity", "生物多様性", "noun", "Challenge", "The project examined biodiversity in the local park.", "その計画は地域の公園の生物多様性を調べました。"],
  ["conservation", "自然保護、保存", "noun", "Challenge", "Wildlife conservation requires long-term action.", "野生生物の保護には長期的な行動が必要です。"],
  ["ecosystem", "生態系", "noun", "Challenge", "Pollution can damage the river ecosystem.", "汚染は川の生態系を損なうことがあります。"],
  ["habitat", "生息地", "noun", "Challenge", "The forest provides a habitat for many species.", "森林は多くの種に生息地を提供します。"],
  ["pollution", "汚染", "noun", "Challenge", "The survey measured pollution near the road.", "その調査は道路付近の汚染を測定しました。"],
  ["renewable", "再生可能な", "adjective", "Challenge", "The school is considering renewable energy.", "学校は再生可能エネルギーを検討しています。"],
  ["emission", "排出、排出物", "noun", "Challenge", "Public transport can reduce carbon emissions.", "公共交通機関は炭素排出量を減らせます。"],
  ["resource", "資源", "noun", "Challenge", "Water is a limited natural resource.", "水は限りある天然資源です。"],
  ["sustainability", "持続可能性", "noun", "Challenge", "The presentation focused on sustainability.", "その発表は持続可能性に焦点を当てました。"],
  ["preserve", "保護する、保存する", "verb", "Challenge", "The campaign aims to preserve the woodland.", "その活動は森林地帯を保護することを目指します。"],
  ["endangered", "絶滅の危機にある", "adjective", "Challenge", "The centre protects endangered animals.", "その施設は絶滅危惧動物を保護しています。"],
  ["species", "種、生物種", "noun", "Challenge", "Several bird species live in the area.", "その地域には数種類の鳥が生息しています。"],
  ["adaptation", "適応、改変", "noun", "Challenge", "Thick leaves are an adaptation to dry conditions.", "厚い葉は乾燥した環境への適応です。"],
  ["impact", "影響、衝撃", "noun", "Challenge", "The report evaluates the impact of climate change.", "報告書は気候変動の影響を評価しています。"],
  ["evidence", "証拠、根拠", "noun", "Challenge", "Use evidence from the text to support your answer.", "本文の根拠を使って解答を支えなさい。"],
  ["hypothesis", "仮説", "noun", "Challenge", "The results supported the original hypothesis.", "結果は最初の仮説を支持しました。"],
  ["variable", "変数、変化させる要因", "noun", "Challenge", "Light was the only variable in the experiment.", "光だけがその実験で変えた要因でした。"],
  ["observation", "観察、観察結果", "noun", "Challenge", "Record each observation in the table.", "それぞれの観察結果を表に記録しなさい。"],
  ["analysis", "分析", "noun", "Challenge", "Her analysis revealed a clear pattern.", "彼女の分析で明確な傾向が分かりました。"],
  ["interpret", "解釈する", "verb", "Challenge", "Interpret the graph before writing a conclusion.", "結論を書く前にグラフを解釈しなさい。"],
  ["conclusion", "結論", "noun", "Challenge", "The evidence led to a different conclusion.", "その証拠から異なる結論に至りました。"],
  ["reliable", "信頼できる", "adjective", "Challenge", "A larger sample can produce more reliable results.", "より大きな標本は信頼性の高い結果につながります。"],
  ["significant", "重要な、著しい", "adjective", "Challenge", "There was a significant difference in growth.", "成長には著しい違いがありました。"],
  ["factor", "要因", "noun", "Challenge", "Soil type was an important factor in plant growth.", "土の種類は植物の成長に重要な要因でした。"],
  ["manufacture", "製造する／製造", "verb/noun", "Challenge", "Machines made it possible to manufacture goods faster.", "機械によって製品をより速く製造できるようになりました。"],
  ["machinery", "機械類", "noun", "Challenge", "New machinery changed factory work.", "新しい機械類が工場の仕事を変えました。"],
  ["invention", "発明", "noun", "Challenge", "The invention transformed transport.", "その発明は交通を大きく変えました。"],
  ["production", "生産、製造", "noun", "Challenge", "Factory production increased rapidly.", "工場生産は急速に増加しました。"],
  ["urbanisation", "都市化", "noun", "Challenge", "Industrial growth accelerated urbanisation.", "産業の発展が都市化を加速させました。"],
  ["agriculture", "農業", "noun", "Challenge", "New machines also changed agriculture.", "新しい機械は農業も変えました。"],
  ["transportation", "輸送、交通手段", "noun", "Core", "Railways improved transportation between cities.", "鉄道は都市間の輸送を改善しました。"],
  ["population", "人口", "noun", "Challenge", "The town's population grew rapidly.", "その町の人口は急速に増えました。"],
  ["development", "発展、開発", "noun", "Challenge", "Industrial development changed daily life.", "産業の発展は日常生活を変えました。"],
  ["transform", "一変させる", "verb", "Challenge", "Electricity transformed homes and workplaces.", "電気は家庭と職場を一変させました。"],
  ["mysterious", "不思議な、謎めいた", "adjective", "Challenge", "A mysterious door appeared in the school.", "学校に不思議な扉が現れました。"],
  ["invisible", "目に見えない", "adjective", "Challenge", "The character suddenly became invisible.", "その登場人物は突然見えなくなりました。"],
  ["encounter", "遭遇する／出会い", "verb/noun", "Challenge", "She encountered a strange creature beyond the door.", "彼女は扉の向こうで不思議な生き物に遭遇しました。"],
  ["consequence", "結果、重大な影響", "noun", "Challenge", "Every choice in the story has a consequence.", "物語のどの選択にも結果が伴います。"],
  ["eventually", "最終的に、やがて", "adverb", "Core", "He eventually found a way back to school.", "彼は最終的に学校へ戻る方法を見つけました。"],
  ["determine", "特定する、決定する", "verb", "Challenge", "The class tried to determine the cause.", "クラスは原因を特定しようとしました。"],
  ["demonstrate", "実証する、示す", "verb", "Challenge", "The experiment demonstrated the effect of light.", "その実験は光の影響を実証しました。"],
  ["evaluate", "評価する", "verb", "Challenge", "Evaluate whether the source is reliable.", "その情報源が信頼できるか評価しなさい。"],
  ["achievement", "達成、成果", "noun", "Core", "Completing the project was a major achievement.", "計画を完成させたことは大きな成果でした。"],
  ["exhibition", "展示会、展覧会", "noun", "Core", "The museum exhibition was fascinating.", "博物館の展示会はとても興味深いものでした。"],
  ["fascinating", "非常に興味深い", "adjective", "Core", "The students found the experiment fascinating.", "生徒たちはその実験を非常に興味深いと感じました。"],
  ["phenomenon", "現象", "noun", "Challenge", "The class investigated a natural phenomenon.", "クラスは自然現象を調査しました。"],
  ["interaction", "相互作用、交流", "noun", "Challenge", "The study examined the interaction between light and growth.", "その研究は光と成長の相互作用を調べました。"],
  ["maintain", "維持する", "verb", "Challenge", "Plants must maintain enough water to survive.", "植物は生き残るために十分な水分を保つ必要があります。"],
  ["capacity", "能力、容量", "noun", "Challenge", "Clay has a high capacity to retain water.", "粘土は水を保持する能力が高いです。"],
  ["essential", "不可欠な、本質的な", "adjective", "Challenge", "Light is essential for photosynthesis.", "光は光合成に不可欠です。"],
  ["indicate", "示す", "verb", "Challenge", "The results indicate that soil type matters.", "結果は土の種類が重要だと示しています。"],
  ["derive", "引き出す、由来する", "verb", "Challenge", "We can derive a conclusion from the evidence.", "証拠から結論を導けます。"],
  ["contrast", "対比する／対照", "verb/noun", "Challenge", "Contrast the two experimental conditions.", "2つの実験条件を対比しなさい。"],
];

const GENERATED = {
  "in order to": ["She left early in order to catch the first train.", "彼女は始発列車に間に合うために早く出発しました。"],
  "even if": ["Try the question even if you are not completely sure.", "完全に確信がなくても、その問題に挑戦してください。"],
  mistake: ["She noticed her mistake and corrected the answer.", "彼女は自分の間違いに気づき、答えを直しました。"],
  suggest: ["I suggest taking the earlier train.", "もっと早い電車に乗ることを提案します。"],
  climate: ["The region has a warm climate for most of the year.", "その地域は一年の大半が温暖な気候です。"],
  plastic: ["The bottle is made of plastic.", "そのボトルはプラスチックでできています。"],
  allow: ["The rules allow students to use the library after school.", "規則により、生徒は放課後に図書館を利用できます。"],
  environment: ["We can protect the environment by reducing waste.", "ごみを減らすことで環境を守れます。"],
  explain: ["Can you explain why you chose that answer?", "なぜその答えを選んだのか説明できますか。"],
  pain: ["He was hurt, but he was not in any pain.", "彼はけがをしましたが、痛みはありませんでした。"],
  power: ["The device needs electrical power.", "その装置には電力が必要です。"],
  catch: ["If you leave now, you can catch the last bus.", "今出発すれば最終バスに間に合います。"],
  reach: ["The train will reach the station at noon.", "その列車は正午に駅へ到着します。"],
  influence: ["Friends can influence the choices we make.", "友人は私たちの選択に影響を与えることがあります。"],
  soil: ["The researchers collected soil from the ground.", "研究者たちは地面から土を採取しました。"],
  begin: ["The meeting will begin at nine o'clock.", "会議は9時に始まります。"],
  nature: ["Scientists can find useful ideas in nature.", "科学者は自然の中から役立つ着想を得ることがあります。"],
  leave: ["We have to leave home by seven.", "私たちは7時までに家を出なければなりません。"],
  experience: ["Travel can be a valuable learning experience.", "旅行は貴重な学習経験になり得ます。"],
  describe: ["How would you describe the dish you tried?", "あなたが食べた料理をどのように説明しますか。"],
  loss: ["The accident caused a serious loss for the company.", "その事故は会社に大きな損失をもたらしました。"],
  discover: ["Researchers hope to discover something new.", "研究者たちは新しい何かを発見したいと考えています。"],
  notice: ["Did you notice the sign near the door?", "ドアの近くの標識に気づきましたか。"],
  agree: ["I agree with your idea because it will save time.", "時間を節約できるので、私はあなたの考えに賛成です。"],
  deliver: ["The company will deliver the package tomorrow.", "会社は明日その荷物を届けます。"],
  important: ["It is important to notice words such as 'however'.", "「however」のような語に気づくことが重要です。"],
  solve: ["We need to solve the problem together.", "私たちは一緒にその問題を解決する必要があります。"],
  support: ["The evidence does not support that conclusion.", "その証拠は、その結論を裏づけていません。"],
  choose: ["Please choose the best answer.", "最も適切な答えを選んでください。"],
  protect: ["The cover helps protect the device from damage.", "そのカバーは装置を損傷から守るのに役立ちます。"],
  result: ["The final result surprised the researchers.", "最終結果は研究者たちを驚かせました。"],
  prefer: ["I prefer the second plan because it is simpler.", "より簡単なので、私は2番目の案の方を好みます。"],
  condition: ["The machine works well under this condition.", "その機械はこの条件下で正常に動きます。"],
  energy: ["Solar panels turn sunlight into energy.", "太陽光パネルは日光をエネルギーに変えます。"],
  "even though": ["Even though he was tired, he continued working.", "彼は疲れていたにもかかわらず、作業を続けました。"],
  insect: ["The researchers found the substance in an insect.", "研究者たちは昆虫の中からその物質を発見しました。"],
  "make sure": ["Make sure you check the final choice.", "最後の選択肢を必ず確認してください。"],
  order: ["Please put the events in the correct order.", "出来事を正しい順序に並べてください。"],
  instead: ["The bus was full, so we walked instead.", "バスが満員だったので、代わりに歩きました。"],
  "up to": ["You can choose up to three activities.", "活動は最大3つまで選べます。"],
  surprise: ["To everyone's surprise, the smallest plant grew the fastest.", "みんなが驚いたことに、いちばん小さな植物が最も速く育ちました。"],
  invite: ["The science club will invite a local researcher to speak.", "科学部は地域の研究者を講演に招きます。"],
  difference: ["The experiment showed a clear difference between the two samples.", "実験は2つの試料の明確な違いを示しました。"],
  miss: ["If you leave late, you may miss the school bus.", "遅く出発すると、スクールバスに乗り遅れるかもしれません。"],
  memory: ["The smell of the sea brought back a childhood memory.", "海の香りが子どもの頃の記憶をよみがえらせました。"],
  complete: ["Each group must complete the report by Friday.", "各グループは金曜日までに報告書を完成させなければなりません。"],
  continue: ["The researchers will continue the experiment next week.", "研究者たちは来週も実験を続けます。"],
  lie: ["The village appears to lie between the river and the forest.", "その村は川と森の間に位置しているようです。"],
  online: ["Students can submit their homework online before midnight.", "生徒は深夜までに宿題をオンラインで提出できます。"],
  data: ["The students collected data from three experiments.", "生徒たちは3つの実験からデータを集めました。"],
  confused: ["Maya felt confused because the instructions were unclear.", "説明が不明瞭だったため、マヤは混乱しました。"],
  dream: ["Her dream is to become an environmental scientist.", "彼女の夢は環境科学者になることです。"],
  cost: ["The new equipment will cost more than the school expected.", "新しい機材には学校の予想以上の費用がかかります。"],
  trouble: ["The team had trouble finding reliable information.", "チームは信頼できる情報を見つけるのに苦労しました。"],
  record: ["Students should record their results in the table.", "生徒は結果を表に記録するべきです。"],
  recycle: ["The school encourages students to recycle plastic bottles.", "学校は生徒にペットボトルをリサイクルするよう勧めています。"],
  yet: ["The results have not been published yet.", "結果はまだ公表されていません。"],
  investigate: ["The class will investigate how light affects plant growth.", "クラスでは光が植物の成長にどう影響するか調査します。"],
  hold: ["The container can hold up to two litres of water.", "その容器には最大2リットルの水が入ります。"],
  human: ["The project examined the effect of human activity on wildlife.", "その研究は人間の活動が野生生物に与える影響を調べました。"],
  expensive: ["The new microscope was too expensive for the club to buy.", "新しい顕微鏡は部が購入するには高価すぎました。"],
  break: ["The glass container may break if you drop it.", "そのガラス容器は落とすと割れるかもしれません。"],
  chance: ["The competition gave her a chance to present her research.", "その大会は彼女に研究を発表する機会を与えました。"],
  amaze: ["The results of the experiment will amaze the students.", "その実験結果は生徒たちを驚かせるでしょう。"],
  follow: ["Please follow the safety instructions during the experiment.", "実験中は安全上の指示に従ってください。"],
  spend: ["The group will spend two weeks collecting data.", "グループは2週間かけてデータを集めます。"],
  close: ["Please close the laboratory door when you leave.", "退出するときは実験室のドアを閉めてください。"],
  interview: ["The students will interview local residents about recycling.", "生徒たちはリサイクルについて地域住民に聞き取りをします。"],
  photosynthesis: ["The class investigated how light affects photosynthesis.", "授業では光が光合成にどう影響するかを調べました。"],
  retention: ["The students measured water retention in three kinds of soil.", "生徒たちは3種類の土の保水性を測定しました。"],
  nutrient: ["Healthy soil contains nutrients that plants need.", "健康な土には植物が必要とする栄養素が含まれます。"],
  recyclable: ["The group collected recyclable plastic after the event.", "グループは行事の後、リサイクル可能なプラスチックを集めました。"],
  wildlife: ["The project aims to protect local wildlife.", "その計画は地域の野生生物を守ることを目的としています。"],
  mammal: ["The researchers recorded every mammal they observed.", "研究者たちは観察したすべての哺乳類を記録しました。"],
  electricity: ["The class carried out an electricity experiment safely.", "クラスは電気の実験を安全に行いました。"],
  biology: ["Biology helps us understand living organisms.", "生物学は生物を理解する助けになります。"],
  practical: ["The experiment gave students practical experience.", "その実験は生徒に実践的な経験を与えました。"],
  document: ["Use reliable documents when preparing your presentation.", "発表の準備には信頼できる資料を使いなさい。"],
  source: ["Check whether each source is reliable.", "それぞれの情報源が信頼できるか確認しなさい。"],
  tourist: ["The survey asked tourists about local transport.", "その調査では観光客に地域の交通について尋ねました。"],
  recycling: ["The school started a recycling project.", "学校はリサイクル計画を始めました。"],
  photograph: ["The old photograph was useful evidence.", "その古い写真は有用な証拠でした。"],
  challenge: ["Finding reliable data was the biggest challenge.", "信頼できるデータを見つけることが最大の課題でした。"],
  rubbish: ["Volunteers collected rubbish near the river.", "ボランティアは川の近くでごみを集めました。"],
  sample: ["Each group examined a different soil sample.", "各グループは異なる土壌試料を調べました。"],
  industrial: ["Industrial development changed the town.", "産業の発展が町を変えました。"],
  revolution: ["The invention caused a revolution in transport.", "その発明は交通に革命をもたらしました。"],
  presentation: ["She used three sources in her presentation.", "彼女は発表で3つの資料を使いました。"],
  measure: ["Measure the amount of water carefully.", "水の量を注意深く測りなさい。"],
  material: ["The students compared two different materials.", "生徒たちは2つの異なる材料を比較しました。"],
  amount: ["The amount of water changed after one hour.", "1時間後、水の量が変化しました。"],
  absorb: ["Plant roots absorb water from the soil.", "植物の根は土から水を吸収します。"],
  release: ["Plants release oxygen during photosynthesis.", "植物は光合成の間に酸素を放出します。"],
  process: ["Explain each stage of the process clearly.", "過程の各段階を明確に説明しなさい。"],
  compare: ["Compare the results before writing your conclusion.", "結論を書く前に結果を比較しなさい。"],
  reduce: ["Recycling can reduce the amount of waste.", "リサイクルは廃棄物の量を減らせます。"],
  waste: ["The project studied how the school handles waste.", "その計画では学校が廃棄物をどう扱うか調べました。"],
  growth: ["The class recorded the growth of each plant.", "クラスは各植物の成長を記録しました。"],
  organism: ["A microscope can reveal a tiny organism.", "顕微鏡で小さな生物を観察できます。"],
  environmental: ["Students discussed an environmental problem.", "生徒たちは環境問題について話し合いました。"],
  collection: ["Data collection continued for two weeks.", "データ収集は2週間続きました。"],
  recording: ["Accurate recording makes the results more reliable.", "正確な記録は結果の信頼性を高めます。"],
  "local community": ["The project received support from the local community.", "その計画は地域社会から支援を受けました。"],
  "climate change": ["Climate change affects plants and wildlife.", "気候変動は植物と野生生物に影響します。"],
  "Industrial Revolution": ["The presentation explained the Industrial Revolution.", "その発表は産業革命について説明しました。"],
};

function idFor(lemma, pos) {
  const kind = lemma.includes(" ") ? "p" : "v";
  return `rik-${kind}-${createHash("sha256").update(`rikkyo-uk-vocab/v0.23.0/${lemma.toLowerCase()}/${pos}`).digest("hex").slice(0, 10)}`;
}
function forms(lemma) {
  const x = lemma.toLowerCase();
  if (x.includes(" ")) return [x];
  const out = new Set([x]);
  if (x.endsWith("y") && !/[aeiou]y$/.test(x)) { out.add(`${x.slice(0, -1)}ies`); out.add(`${x.slice(0, -1)}ied`); }
  else { out.add(`${x}s`); out.add(`${x}ed`); }
  out.add(x.endsWith("e") ? `${x.slice(0, -1)}ing` : `${x}ing`);
  return [...out];
}
function matcher(list) { return new RegExp(`\\b(?:${list.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\s+/g, "\\s+")).join("|")})\\b`, "gi"); }
function normalizePos(pos) {
  return pos.replaceAll("adj.", "adjective").replaceAll("adv.", "adverb").replaceAll("conj.", "conjunction").replaceAll("prep.", "preposition").replaceAll("n.", "noun").replaceAll("v.", "verb").replaceAll("/", "/");
}

const fromBaseline = (path) => execFileSync("git", ["show", `${BASELINE_COMMIT}:${path}`], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
const chunks = Array.from({ length: 13 }, (_, i) => JSON.parse(fromBaseline(`public/data/core-${String(i).padStart(2, "0")}.json`))).flat();
const oldByLemma = new Map();
for (const row of chunks) {
  const key = row[1].toLowerCase();
  const previous = oldByLemma.get(key);
  if (!previous || (row[6] === "Core" && previous[6] !== "Core") || row[4] < previous[4]) oldByLemma.set(key, row);
}

function pageParts(text) {
  const parts = text.split(/===== PAGE\s+0?(\d+) =====/g);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ page: Number(parts[i]), text: parts[i + 1] ?? "" });
  return out.length ? out : [{ page: 0, text }];
}
function normalized(text) { return text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim(); }
function sentenceParts(text) {
  return normalized(text).split(/(?<=[.!?])\s+(?=[A-Z"(])/)
    .map((x) => x.trim().replace(/\s+\d+(?:[.,])?$/, ""))
    .filter((x) => x.length >= 28 && x.length <= 210 && (x.match(/[a-z]/g)?.length ?? 0) >= 18)
    .filter((x) => !/[\[\]_*|/=\\]/.test(x) && !/\(\s*\)/.test(x) && !/\b[A-Z]{4,}\b/.test(x))
    .filter((x) => ((x.match(/[A-Za-z]/g)?.length ?? 0) / x.length) >= 0.58);
}
const ocr = await Promise.all(OCR_KEYS.map(async (key) => {
  const text = await readFile(new URL(`../../tmp/pdfs/${key}-ocr.txt`, import.meta.url), "utf8");
  return { key, text, pages: pageParts(text) };
}));
const wasedaText = await readFile(new URL("../../english-vocab/src/waseda-bootstrap/10-waseda-data.js", import.meta.url), "utf8");
function parseJsonConst(source, name) {
  const start = source.indexOf(`const ${name}=`) + `const ${name}=`.length;
  const opening = source[start];
  const closing = opening === "[" ? "]" : "}";
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === opening) depth += 1;
    else if (char === closing && --depth === 0) return JSON.parse(source.slice(start, i + 1));
  }
  throw new Error(`Unable to parse ${name}`);
}
const waseda = parseJsonConst(wasedaText, "VOCAB");
const wasedaCloze = parseJsonConst(wasedaText, "CLOZE");

function evidenceFor(lemma, suppliedForms = forms(lemma)) {
  const evidence = [];
  for (const doc of ocr) {
    for (const page of doc.pages) {
      const count = page.text.match(matcher(suppliedForms))?.length ?? 0;
      if (!count) continue;
      const [year, schedule] = OCR_META[doc.key];
      evidence.push({ year, schedule, page: page.page, count, category: year === 2026 && page.page >= 8 ? "academic-practical" : "reading-language" });
    }
  }
  return evidence;
}
function sourceExampleFor(lemma, suppliedForms = forms(lemma)) {
  if (SOURCE_EXAMPLE_EXCLUDE.has(lemma.toLowerCase())) return null;
  let best = null;
  for (const doc of ocr) for (const page of doc.pages) {
    if (page.page < 5) continue;
    for (const sentence of sentenceParts(page.text)) {
    const hit = sentence.match(matcher(suppliedForms));
    if (!hit) continue;
    const [year, schedule] = OCR_META[doc.key];
    const score = (page.page >= 5 ? 30 : 0) + (year === 2026 ? 15 : 0) - Math.abs(105 - sentence.length);
    if (!best || score > best.score) best = { score, sentence, matchedForm: hit[0], year, schedule, page: page.page };
    }
  }
  if (!best) return null;
  const override = SOURCE_SENTENCE_OVERRIDES[lemma.toLowerCase()];
  if (override) {
    const hit = override.match(matcher(suppliedForms));
    if (!hit) throw new Error(`source override does not contain ${lemma}`);
    best = { ...best, sentence: override, matchedForm: hit[0] };
  }
  const { score: _score, ...example } = best;
  return example;
}

const retained = [...oldByLemma.values()].filter((row) => !EXCLUDE.has(row[1].toLowerCase())).map((row) => {
  const evidence = evidenceFor(row[1]);
  const frequency = evidence.reduce((n, x) => n + x.count, 0);
  const key = row[1].toLowerCase();
  const band = CHALLENGE_KEEP.has(key) ? "Challenge" : FOUNDATION_KEEP.has(key) ? "Foundation" : "Core";
  const score = 150 + (row[4] === "S" ? 20 : row[4] === "A" ? 12 : 5) + Math.min(frequency, 15) * 3;
  return { row: [...row.slice(0, 5), "core", band, ["A", "B"], true, true], evidence, score, origin: "retained" };
});

const additions = waseda.filter((v) => !oldByLemma.has(v.word.toLowerCase()) && !EXCLUDE.has(v.word.toLowerCase())).map((v) => {
  const evidence = evidenceFor(v.word, v.forms ?? forms(v.word));
  const frequency = evidence.reduce((n, x) => n + x.count, 0);
  if (!frequency) return null;
  const papers = new Set(evidence.map((x) => `${x.year}-${x.schedule}`)).size;
  const key = v.word.toLowerCase();
  const band = CHALLENGE_KEEP.has(key) ? "Challenge" : FOUNDATION_KEEP.has(key) ? "Foundation" : "Core";
  const priority = papers >= 2 || frequency >= 5 ? "S" : v.priority === "S" ? "A" : "B";
  const row = [idFor(v.word, normalizePos(v.pos)), v.word, v.meaning, normalizePos(v.pos), priority, band === "Challenge" ? "challenge" : "core", band, ["A", "B"], true, true];
  // Waseda level is a score-target field, so it must never affect lexical band.
  const score = 220 + papers * 24 + Math.min(frequency, 12) * 4;
  return { row, evidence, score, origin: "waseda-crosscheck" };
}).filter(Boolean);

const curated = [...MANUAL, ...TRANSFER].filter(([lemma]) => !EXCLUDE.has(lemma.toLowerCase())).map(([lemma, meaning, pos, band, sentence, ja]) => {
  const evidence = evidenceFor(lemma);
  const frequency = evidence.reduce((n, x) => n + x.count, 0);
  const row = [idFor(lemma, pos), lemma, meaning, pos, frequency >= 2 ? "S" : band === "Challenge" ? "A" : "B", band === "Challenge" ? "challenge" : "core", band, ["A", "B"], true, true];
  const generated = sentence ? { sentence, ja, provenance: "generated-from-rikkyo-patterns" } : null;
  return { row, evidence, generated, score: 500 + frequency * 5, origin: sentence ? "rikkyo-transfer" : "rikkyo-academic" };
});

const unique = new Map();
for (const item of [...retained, ...additions, ...curated].sort((a, b) => b.score - a.score)) {
  const key = item.row[1].toLowerCase();
  if (!unique.has(key)) unique.set(key, item);
}
const quotas = { Foundation: 30, Core: 151, Challenge: 60 };
const selected = Object.entries(quotas).flatMap(([band, count]) => {
  const rows = [...unique.values()].filter((item) => item.row[6] === band).sort((a, b) => b.score - a.score || a.row[1].localeCompare(b.row[1]));
  if (rows.length < count) throw new Error(`insufficient ${band}: ${rows.length}/${count}`);
  return rows.slice(0, count);
}).sort((a, b) => a.row[0].localeCompare(b.row[0]));
if (selected.length !== 241) throw new Error(`selected:${selected.length}`);
if (new Set(selected.map((x) => x.row[0])).size !== 241) throw new Error("duplicate selected stable ID");

const previousRegistry = JSON.parse(await readFile(new URL("../public/data/registry.json", import.meta.url), "utf8"));
const registry = [...new Set([...previousRegistry, ...selected.map((x) => x.row[0])])].sort();

function generatedFor(lemma) {
  const fixed = GENERATED[lemma];
  if (fixed) return { sentence: fixed[0], ja: fixed[1], provenance: "generated-from-rikkyo-patterns" };
  if (wasedaCloze[lemma]) throw new Error(`Missing curated Japanese translation for generated example: ${lemma}`);
  return null;
}
function replaceFirst(text, list) {
  const pattern = matcher(list);
  return text.replace(new RegExp(pattern.source, "i"), "_____");
}
const entities = {};
for (const item of selected) {
  const [stableId, lemma, meaningJa, , priority, studyLayer, targetBand] = item.row;
  const evidence = item.evidence;
  const sourceExample = sourceExampleFor(lemma);
  const generatedExample = item.generated ?? generatedFor(lemma);
  const sourceCloze = sourceExample?.matchedForm.toLowerCase() === lemma.toLowerCase()
    ? replaceFirst(sourceExample.sentence, [sourceExample.matchedForm])
    : "";
  const generatedCloze = generatedExample ? replaceFirst(generatedExample.sentence, [lemma]) : "";
  const clozeSentence = sourceCloze.includes("_____") ? sourceCloze : generatedCloze;
  entities[stableId] = {
    stableId, lemma, meaningJa, priority, studyLayer, targetBand, schedules: ["A", "B"],
    observedFrequency: evidence.reduce((n, x) => n + x.count, 0),
    years: [...new Set(evidence.map((x) => x.year))].sort(),
    sourceSchedules: [...new Set(evidence.map((x) => x.schedule))].sort(),
    categories: [...new Set(evidence.map((x) => x.category))], evidence,
    sourceExample, generatedExample,
    cloze: clozeSentence.includes("_____") ? { sentence: clozeSentence, answer: lemma, provenance: sourceCloze.includes("_____") ? "past-paper-derived" : "generated-from-rikkyo-patterns" } : null,
    selectionOrigin: item.origin,
  };
}

for (let i = 0; i < 13; i += 1) {
  const rows = selected.slice(i * 20, i * 20 + 20).map((x) => x.row);
  await writeFile(new URL(`../public/data/core-${String(i).padStart(2, "0")}.json`, import.meta.url), `${JSON.stringify(rows)}\n`);
}
await writeFile(new URL("../public/data/registry.json", import.meta.url), `${JSON.stringify(registry)}\n`);
await writeFile(new URL("../public/data/enrichment.json", import.meta.url), `${JSON.stringify({
  format: "rikkyo-vocab-enrichment/v1", version: "2026-09-17-reselected-v4",
  sourceScope: ["FY24-A", "FY24-B", "FY25-A", "FY25-B", "FY26-A", "FY26-B"],
  generationMethod: "lexical-difficulty selection independent of score bands; sense-aware paper evidence; Rikkyo-theme transfer vocabulary; audio-optional generated practice sentences",
  entityCount: 241,
  sourceMatchedEntityCount: Object.values(entities).filter((x) => x.evidence.length).length,
  generatedFallbackCount: Object.values(entities).filter((x) => x.generatedExample).length,
  entities,
}, null, 2)}\n`);

const bands = Object.groupBy(selected, (x) => x.row[6]);
const origins = Object.groupBy(selected, (x) => x.origin);
console.log(JSON.stringify({
  active: selected.length, registry: registry.length,
  bands: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, v.length])),
  origins: Object.fromEntries(Object.entries(origins).map(([k, v]) => [k, v.length])),
  retiredFromPreviousCore: chunks.filter((row) => !selected.some((x) => x.row[0] === row[0])).length,
}, null, 2));
