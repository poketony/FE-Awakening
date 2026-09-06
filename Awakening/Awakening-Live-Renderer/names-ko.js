// In-game display names mirrored from Awakening/Messages (K)/GameData.txt.
// Korean preview uses the translated values; Japanese preview can fall back to the original Japanese IDs.

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

const RAW_NAMES = `
名前最大\t이름 여섯 자
デフォルト名\t러플레
プレイヤー\t플레이어
クロム\t크롬
リズ\t리사
フレデリク\t프레데릭
ヴィオール\t비오르
ソワレ\t수아레
ヴェイク\t베이크
ソール\t소르
ミリエル\t미리엘
カラム\t카람
スミア\t스미아
ロンクー\t론쿠
リヒト\t리히트
マリアベル\t마리아벨
リベラ\t리베라
ベルベット\t벨벳
ガイア\t가이아
ティアモ\t코델리아
レオパルド\t레오폴드
ノノ\t노노
サーリャ\t사랴
グレゴ\t그레고
オリヴィエ\t올리비에
セルジュ\t세르주
ヘンリー\t헨리
トレイシー\t트레이시
マルス\t마르스
サイリ\t사이리
ドニ\t도니
ウード\t오웬
アズール\t이니고
ブレディ\t브레디
デジェル\t데젤
シンシア\t신시아
セレナ\t세베라
ジェローム\t제롬
マーク\t마크
マーク男\t마크
マーク女\t마크
シャンブレー\t샴브레이
ロラン\t로랑
ノワール\t누아르
ンン\t응응
チキ\t치키
アンナ\t안나
インバース\t인버스
バジーリオ\t바질리오
フラヴィア\t플라비아
パリス\t파리스
アンドレア\t안드레아
エメリナ\t에메리나
ギャンレル\t갱렐
ヴァルハルト\t발하르트
レンハ\t렌하
屍兵\t시체 병사
ルキナ\t루키나
商人\t상인
ボス\t적장
フェリア兵\t페리아병
ペレジア兵\t펠레지아병
ヴァルム兵\t바룸병
ギムレー教兵\t그리마 교단
謎の一団\t수수께끼의 일당
傭兵\t용병
フィレイン\t피레인
エクセライ\t엑셀라이
セルバンテス\t세르반테스
青軍兵士\t병사
赤軍兵士\t적 병사
村人\t마을 사람
村人男\t마을 사람
村人女\t마을 처녀
村長\t촌장
老人\t노인
？？？\t???
神官\t신관
密偵\t밀정
暗殺者\t암살자
兵士\t병사
兵士Ａ\t병사
兵士Ｂ\t용기사
ならず者\t불량배
ならず者Ａ\t불량배
ならず者Ｂ\t불량배
ペガサス\t페가수스
ミネルヴァ\t미네르바
ベッラ\t벨라
ファウダー\t파우더
ファウダーの影\t그림자
ナーガ\t나가
ギムレー\t그리마
フードの人物\t???
シルエット\t???
P002_ボス\t게리바
001_ボス\t시체 병장
002_ボス\t시체 병장
003_ボス\t라이미
004_ボス\t마르스
005_ボス\t알리오
006_ボス\t파우더
007_ボス\t올리오
008_ボス\t샤랄
009_ボス\t포모도르
010_ボス\t무스타파
011_ボス\t갱렐
012_ボス\t도르히
013_ボス\t시체 병장
014_ボス\t브라제
015_ボス\t하펜
016_ボス\t세르반테스
017_ボス\t펠스
018_ボス\t렌하
019_ボス\t발하르트
020_ボス\t발하르트
021_ボス\t알골
022_ボス\t인버스
023_ボス\t파우더
024_ボス\t시체 병장
025_ボス\t인버스
026_ボス\t그리마
X001_ボス\t로무고
X002_ボス\t핸섬
X003_ボス\t시체 병장
X004_ボス\t조지
X005_ボス\t게코
X006_ボス\t자미르
X007_ボス\t자키하
X008_ボス\t카치디스
X009_ボス\t류겔
X010_ボス\t넬슨
X011_ボス\t모리스티아
X012_ボス\t시체 병장
ボスＡ\t지라르
ボスＢ\t딘
X014_ボス\t나다베
X015_ボス\t이자사
X016_ボス\t시체 병장
X017_ボス\t시체 병장
X018_ボス\t자하
X019_ボス\t발하르트
X020_ボス\t칸
X021_ボス\t시체 병장
X022_ボス\t적장
X023_ボス\t파리스
クロム嫁村娘\t마을 처녀
ホラント\t홀란드
山賊\t산적
山賊Ａ\t산적
山賊Ｂ\t산적
母親\t모친
行商人\t행상인
騎士\t기사
アインス\t아인스
ツヴァイ\t츠바이
ドライ\t드라이
フィーア\t피어
フュンフ\t퓐프
ゼクス\t젝스
ズィーベン\t지벤
アハト\t아흐트
ノイン\t노인
ツェーン\t첸
エルフ\t엘프
ツヴェルフ\t츠뵐프
異界の者\t이계의 사람
緑軍賢者\t마을 사람
`;

export const KOREAN_NAME_MAP = new Map(
  RAW_NAMES.trim().split("\n").map((line) => line.split("\t", 2)),
);

export const JAPANESE_ORIGINAL_NAME_MAP = new Map(
  [...KOREAN_NAME_MAP.keys()].map((id) => [id, id]),
);

export function containsJapanese(value) {
  return JAPANESE.test(String(value || ""));
}

export function cleanCharacterId(value) {
  return String(value || "").replace(/画像なし|素顔/gu, "").replace(/[白黒透]$/u, "");
}

export function koreanCharacterName(characterId, playerName = "러플레") {
  const id = String(characterId || "");
  if (id.startsWith("username") || id.startsWith("プレイヤー")) return playerName || "러플레";
  const clean = cleanCharacterId(id);
  return KOREAN_NAME_MAP.get(id) || KOREAN_NAME_MAP.get(clean) || "";
}

export function japaneseCharacterName(characterId, playerName = "ルフレ") {
  const id = String(characterId || "");
  if (id.startsWith("username") || id.startsWith("プレイヤー")) return playerName || "ルフレ";
  const clean = cleanCharacterId(id);
  return JAPANESE_ORIGINAL_NAME_MAP.get(id) || JAPANESE_ORIGINAL_NAME_MAP.get(clean) || clean || id;
}
