// Демонстрационный каталог для `npm run seed`. Тайтлы, авторы, персонажи и команда перевода вымышленные:
// реальные произведения в демо не добавляются, потому что прав на их главы нет (см. migrations/0006).
// rating — оценка редакции из карточки. Оценок и голосов читателей seed не создаёт: они появляются только от людей.
// tags: [код тега из migrations/0016_platform.sql, вес 1–3]. chapters — сколько глав создать (страницы — демо-SVG)

export const DEMO_TRANSLATOR = "Endemion Demo";

export const GENRE_DESCRIPTIONS = {
  "Экшен": "Сражения, погони и динамичные сцены.",
  "Фэнтези": "Магия, другие миры и существа.",
  "Романтика": "Истории о любви и отношениях.",
  "Драма": "Сильные чувства и сложный выбор.",
  "Комедия": "Истории, над которыми смеёшься.",
  "Повседневность": "Обычная жизнь, увиденная по-особенному.",
  "Приключения": "Путешествия и открытия.",
  "Ужасы": "Страх, тьма и неизвестное.",
  "Триллер": "Напряжение до последней страницы.",
  "Психология": "Внутренний мир героев.",
  "Детектив": "Загадки и расследования.",
  "Боевые искусства": "Школы, техники и поединки.",
  "Фантастика": "Технологии, космос и будущее.",
  "Исторический": "Прошлое, эпохи и династии.",
  "Спорт": "Соревнования и командный дух."
};

export const TITLES = [
  {
    title: "Пепел девятой луны", originalTitle: "Kokonotsu no Tsuki no Hai", type: "manga", year: 2019, status: "completed", rating: 9.1,
    genres: ["Экшен", "Фэнтези", "Драма"], author: "Харуто Мидзусима", symbol: "☾", colors: ["#1b1f4a", "#5b3f9a", "#e3b5c9"],
    description: "Последний ученик разрушенной школы мечников идёт по следу демона, который забрал луну с неба его деревни.",
    chapters: 24, tags: [["mood-dark", 3], ["mood-epic", 2], ["hero-growth", 3], ["plot-revenge", 3], ["theme-loss", 2], ["theme-power", 2], ["plot-twist", 2]],
    characters: [["Рэн Кагэяма", "main", "Ученик-мечник, потерявший всё", "⚔"], ["Мика Сэндо", "supporting", "Лучница из горного клана", "🏹"], ["Демон Цукигами", "antagonist", "Пожиратель лун", "☾"]]
  },
  {
    title: "Тетрадь последнего лета", originalTitle: "Saigo no Natsu no Nōto", type: "manga", year: 2022, status: "ongoing", rating: 8.7, releaseDay: 3,
    genres: ["Драма", "Повседневность", "Детектив"], author: "Аой Сэкигава", symbol: "✎", colors: ["#20384a", "#5f97ad", "#f3e3b0"],
    description: "Школьница находит тетрадь, в которой кто-то описал её лето заранее. День за днём записи сбываются, и последняя страница пугает.",
    chapters: 18, tags: [["mood-melancholic", 3], ["mood-mysterious", 2], ["plot-mystery", 2], ["plot-time-loop", 2], ["plot-school", 2], ["theme-friendship", 2], ["plot-twist", 3]],
    characters: [["Хина Асахара", "main", "Девушка, которая читает своё будущее", "✎"], ["Сота Кирю", "supporting", "Одноклассник со странной памятью", "☁"]]
  },
  {
    title: "Кухня у старого храма", originalTitle: "Furudera no Daidokoro", type: "manga", year: 2021, status: "ongoing", rating: 8.4, releaseDay: 5,
    genres: ["Комедия", "Повседневность", "Фэнтези"], author: "Кэнта Мурасэ", symbol: "🍙", colors: ["#3e2a20", "#b8764f", "#f5d595"],
    description: "Бывший шеф-повар открывает закусочную рядом с храмом. Посетители — духи, и у каждого свой любимый рецепт из прошлой жизни.",
    chapters: 16, tags: [["mood-cozy", 3], ["mood-warm", 3], ["mood-funny", 2], ["theme-food", 3], ["setting-village", 2], ["hero-ordinary", 2]],
    characters: [["Дайсукэ Оно", "main", "Повар, который слышит духов", "🍳"], ["Кицунэ Юзу", "supporting", "Лиса-хранительница храма", "🦊"]]
  },
  {
    title: "Хроники Шестых Врат", originalTitle: "Yuksbeonjjae Mun", type: "manhwa", year: 2020, status: "ongoing", rating: 9.0, releaseDay: 1,
    genres: ["Экшен", "Фэнтези", "Приключения"], author: "Пак Джи Хун", symbol: "⛩", colors: ["#0b1026", "#3b2a7a", "#8f7bff"],
    description: "Над Сеулом открываются врата в подземелья. Хан Сэ Мин, охотник низшего ранга, получает доступ к системе, которая видит слабости монстров.",
    chapters: 30, tags: [["hero-growth", 3], ["plot-leveling", 3], ["setting-dungeon", 3], ["setting-modern-city", 2], ["mood-epic", 2], ["theme-power", 2]],
    characters: [["Хан Сэ Мин", "main", "Охотник, который начал с самого низа", "⚡"], ["Юн Ха Ра", "supporting", "Глава гильдии «Северный ветер»", "❄"], ["Король Врат", "antagonist", "Тот, кто открывает подземелья", "⛩"]]
  },
  {
    title: "Злодейка не хочет финала", originalTitle: "Akdangeun Gyeolmal-eul Wonhaji Anneunda", type: "manhwa", year: 2021, status: "ongoing", rating: 8.8, releaseDay: 2,
    genres: ["Романтика", "Фэнтези", "Комедия"], author: "Со Ын Би", symbol: "🌹", colors: ["#3a0f2a", "#a53570", "#f7b6d2"],
    description: "Студентка просыпается в теле злодейки из любимого романа, которой по сюжету осталось жить полгода. Она переписывает историю шаг за шагом.",
    chapters: 22, tags: [["hero-reincarnated", 3], ["hero-female", 3], ["hero-villain", 2], ["theme-love", 2], ["plot-slowburn", 2], ["setting-palace", 2], ["mood-funny", 2], ["plot-politics", 2]],
    characters: [["Леонора Эшфорд", "main", "Злодейка с чужой памятью", "🌹"], ["Кайрен Вальтер", "supporting", "Наследный принц", "👑"]]
  },
  {
    title: "Последний свет Нового Пусана", originalTitle: "Sin Busan-ui Majimak Bit", type: "manhwa", year: 2023, status: "ongoing", rating: 8.6, releaseDay: 4,
    genres: ["Ужасы", "Триллер", "Драма"], author: "Ким Тэ Ён", symbol: "☣", colors: ["#0d1612", "#2c5a44", "#a8e0b5"],
    description: "Город за стеной, снаружи — туман, из которого не возвращаются. Медсестра ищет брата и узнаёт, кто на самом деле построил стену.",
    chapters: 20, tags: [["mood-dark", 3], ["mood-tense", 3], ["plot-survival", 3], ["setting-postapoc", 3], ["theme-family", 2], ["plot-twist", 2], ["theme-loss", 2]],
    characters: [["Чон Да Ын", "main", "Медсестра из восточного квартала", "✚"], ["Капитан Ли", "antagonist", "Командир стражи стены", "🛡"]]
  },
  {
    title: "Код небесного дракона", originalTitle: "Tianlong Mima", type: "manhua", year: 2020, status: "ongoing", rating: 8.5, releaseDay: 6,
    genres: ["Боевые искусства", "Фэнтези", "Экшен"], author: "Лин Сяо", symbol: "龙", colors: ["#2a0c0c", "#9c2d2d", "#f2c46d"],
    description: "Слуга изгнанного клана находит фрагмент техники Небесного дракона. Каждая ступень культивации стоит ему одного воспоминания.",
    chapters: 28, tags: [["theme-cultivation", 3], ["hero-growth", 3], ["setting-ancient-china", 3], ["plot-tournament", 2], ["theme-power", 3], ["plot-revenge", 2]],
    characters: [["Е Чэнь", "main", "Слуга, ставший наследником техники", "龙"], ["Бай Лянь", "supporting", "Целительница секты Лотоса", "🪷"], ["Патриарх Мо", "antagonist", "Глава секты Чёрной горы", "⛰"]]
  },
  {
    title: "Чайный дом на Нефритовой улице", originalTitle: "Feicui Jie Chaguan", type: "manhua", year: 2022, status: "completed", rating: 8.2,
    genres: ["Романтика", "Исторический", "Повседневность"], author: "Чжао Минь", symbol: "🍵", colors: ["#173328", "#3f8a6b", "#e8e1b0"],
    description: "Дочь опального чиновника держит чайный дом в столице. Под видом посетителя к ней приходит тот, кто подписал приказ о ссылке её отца.",
    chapters: 14, tags: [["theme-love", 3], ["plot-slowburn", 3], ["mood-warm", 2], ["setting-palace", 1], ["setting-ancient-china", 2], ["hero-female", 2], ["plot-politics", 1]],
    characters: [["Су Цинь", "main", "Хозяйка чайного дома", "🍵"], ["Лу Сюань", "supporting", "Молодой министр", "🖋"]]
  },
  {
    title: "Девятый ученик звёздной академии", originalTitle: "Byeol Akademi Ahop Beonjjae Jeja", type: "manhwa", year: 2022, status: "ongoing", rating: 8.3, releaseDay: 0,
    genres: ["Фэнтези", "Комедия", "Экшен"], author: "Ли Мин Сок", symbol: "✦", colors: ["#141a46", "#4064c8", "#9ee6ff"],
    description: "Гений боевой магии прячет свою силу в академии, где ему положено быть худшим учеником. Скрываться становится всё сложнее.",
    chapters: 19, tags: [["hero-overpowered", 3], ["hero-genius", 2], ["setting-academy", 3], ["plot-school", 2], ["mood-funny", 2], ["plot-tournament", 1]],
    characters: [["Ин Харам", "main", "Ученик, который скрывает силу", "✦"], ["Кан Сео", "supporting", "Староста класса", "📘"]]
  },
  {
    title: "Ржавые крылья Неонового квартала", originalTitle: "Neon-gai no Sabita Tsubasa", type: "manga", year: 2018, status: "completed", rating: 8.9,
    genres: ["Фантастика", "Экшен", "Психология"], author: "Рё Кавасима", symbol: "⚙", colors: ["#0b0f25", "#c43fb0", "#43e2ff"],
    description: "Курьер с механическими крыльями доставляет посылки над кварталом корпораций. Одна посылка оказывается человеком, которого ищут все.",
    chapters: 26, tags: [["setting-cyberpunk", 3], ["hero-antihero", 2], ["mood-tense", 2], ["theme-identity", 3], ["plot-twist", 3], ["theme-justice", 2]],
    characters: [["Сора Исидзаки", "main", "Курьер с механическими крыльями", "⚙"], ["Нэко", "supporting", "Девочка из посылки", "🐾"], ["Директор Камуи", "antagonist", "Глава корпорации «Гелиос»", "☀"]]
  },
  {
    title: "Обещание у моря", originalTitle: "Umi no Yakusoku", type: "manga", year: 2023, status: "ongoing", rating: 8.0, releaseDay: 3,
    genres: ["Романтика", "Драма", "Повседневность"], author: "Юи Хамада", symbol: "🌊", colors: ["#13314a", "#3d86b5", "#bfe8f5"],
    description: "Через десять лет после выпуска двое бывших одноклассников встречаются в приморском городке, где когда-то дали друг другу обещание.",
    chapters: 12, tags: [["theme-love", 3], ["mood-melancholic", 2], ["mood-warm", 2], ["plot-slowburn", 3], ["setting-village", 2]],
    characters: [["Нанами Кудо", "main", "Фотограф, вернувшаяся домой", "📷"], ["Харуки Мори", "main", "Рыбак и бывший пианист", "🎹"]]
  },
  {
    title: "Государь из пепла", originalTitle: "Huijin Zhi Jun", type: "manhua", year: 2019, status: "completed", rating: 9.2,
    genres: ["Исторический", "Драма", "Экшен"], author: "Сюй Тянь", symbol: "♛", colors: ["#26140a", "#8a4b1c", "#f0c27a"],
    description: "Принц, которого считали мёртвым, возвращается в столицу под чужим именем. Чтобы вернуть трон, ему придётся стать тем, кого он ненавидел.",
    chapters: 32, tags: [["plot-politics", 3], ["hero-genius", 3], ["plot-revenge", 2], ["setting-palace", 3], ["theme-war", 2], ["hero-antihero", 2], ["plot-twist", 2]],
    characters: [["Чжао Юнь", "main", "Изгнанный принц", "♛"], ["Генерал Хань", "supporting", "Командующий северной армией", "🛡"], ["Императрица Вэй", "antagonist", "Регент при малолетнем императоре", "🦚"]]
  },
  {
    title: "Пятёрка с нижнего этажа", originalTitle: "Jiha-ui Daseot", type: "manhwa", year: 2024, status: "ongoing", rating: 8.1, releaseDay: 5,
    genres: ["Комедия", "Повседневность", "Драма"], author: "Чхве Ю На", symbol: "★", colors: ["#2d1b3d", "#7b4ca8", "#ffd27a"],
    description: "Пятеро соседей по полуподвальной квартире в Сеуле пытаются выжить, найти работу мечты и не поубивать друг друга.",
    chapters: 15, tags: [["hero-ensemble", 3], ["mood-funny", 3], ["mood-warm", 2], ["theme-friendship", 3], ["setting-modern-city", 2], ["hero-ordinary", 2]],
    characters: [["До Ха Ён", "main", "Начинающая веб-художница", "🎨"], ["Пак Мин Чжэ", "supporting", "Повар в ночной смене", "🍜"]]
  },
  {
    title: "Шахматист теневого двора", originalTitle: "Kage no Kishi", type: "manga", year: 2020, status: "ongoing", rating: 8.6, releaseDay: 2,
    genres: ["Психология", "Триллер", "Детектив"], author: "Сатоси Ивамото", symbol: "♞", colors: ["#121212", "#4a4a5e", "#d9d0b8"],
    description: "Гений-шахматист расследует серию исчезновений в элитной школе. Преступник оставляет на месте шахматную фигуру и ждёт ответного хода.",
    chapters: 21, tags: [["hero-genius", 3], ["plot-mystery", 3], ["mood-tense", 3], ["plot-twist", 3], ["mood-mysterious", 2], ["plot-school", 1]],
    characters: [["Рэй Курогане", "main", "Шахматист-детектив", "♞"], ["Неизвестный «Ферзь»", "antagonist", "Тот, кто оставляет фигуры", "♛"]]
  },
  {
    title: "Песнь ледяного перевала", originalTitle: "Bingfeng Ge", type: "manhua", year: 2021, status: "ongoing", rating: 8.4, releaseDay: 1,
    genres: ["Приключения", "Фэнтези", "Боевые искусства"], author: "Лин Сяо", symbol: "❄", colors: ["#0c1f33", "#4a8bc4", "#e6f6ff"],
    description: "Караван идёт через перевал, где живут ледяные духи. Юная проводница ведёт его к Северному храму, где хранится лекарство от чумы.",
    chapters: 17, tags: [["plot-journey", 3], ["hero-female", 3], ["setting-other-world", 1], ["mood-epic", 2], ["theme-cultivation", 1], ["hero-ensemble", 2]],
    characters: [["Сюэ Нин", "main", "Проводница каравана", "❄"], ["Старик Гу", "supporting", "Торговец со множеством тайн", "🎒"]]
  },
  {
    title: "Свет в Подземном городе", originalTitle: "Chika Toshi no Akari", type: "manga", year: 2017, status: "completed", rating: 8.8,
    genres: ["Фантастика", "Приключения", "Драма"], author: "Мэгуми Исикава", symbol: "◉", colors: ["#1d1a10", "#7a6a2c", "#ffe59a"],
    description: "Люди живут под землёй уже триста лет. Мальчик-ремонтник находит работающий фонарь, указывающий путь на поверхность.",
    chapters: 22, tags: [["plot-journey", 3], ["setting-postapoc", 2], ["theme-friendship", 2], ["mood-epic", 2], ["hero-ordinary", 2], ["plot-twist", 2]],
    characters: [["Тому", "main", "Мальчик-ремонтник", "🔦"], ["Айра", "supporting", "Картограф подземелий", "🗺"]]
  },
  {
    title: "Рыцарь, которого не призывали", originalTitle: "Sohwandoeji Anheun Gisa", type: "manhwa", year: 2022, status: "ongoing", rating: 8.7, releaseDay: 6,
    genres: ["Фэнтези", "Экшен", "Приключения"], author: "Пак Джи Хун", symbol: "🗡", colors: ["#1d1630", "#5e3d8f", "#d8b4ff"],
    description: "Вместе с героем в другой мир случайно переносит его соседа по офису. Системы у него нет, зато он помнит концовку этой игры.",
    chapters: 25, tags: [["setting-other-world", 3], ["hero-ordinary", 2], ["hero-genius", 2], ["plot-leveling", 2], ["mood-funny", 1], ["plot-journey", 2], ["plot-twist", 2]],
    characters: [["Ким Ю Чжин", "main", "Офисный работник в чужом мире", "🗡"], ["Принцесса Элира", "supporting", "Наследница павшего королевства", "👑"]]
  },
  {
    title: "Дом на краю кладбища", originalTitle: "Bochi no Hazure no Ie", type: "manga", year: 2024, status: "ongoing", rating: 7.9, releaseDay: 4,
    genres: ["Ужасы", "Детектив", "Психология"], author: "Аой Сэкигава", symbol: "🕯", colors: ["#100e14", "#3b2f4a", "#b6a7c9"],
    description: "Семья переезжает в дешёвый дом у старого кладбища. Младшая дочь начинает рисовать людей, которые умерли сто лет назад.",
    chapters: 11, tags: [["mood-dark", 3], ["mood-mysterious", 3], ["plot-mystery", 2], ["theme-family", 2], ["setting-village", 1]],
    characters: [["Юки Ханада", "main", "Старшая сестра", "🕯"], ["Мио Ханада", "supporting", "Девочка, которая рисует призраков", "🖍"]]
  },
  {
    title: "Ракетка и шторм", originalTitle: "Raketto to Arashi", type: "manga", year: 2023, status: "ongoing", rating: 8.2, releaseDay: 0,
    genres: ["Спорт", "Драма", "Комедия"], author: "Кэнта Мурасэ", symbol: "🏸", colors: ["#0f2a1a", "#2f9a5b", "#e9ffb8"],
    description: "Бадминтонная команда провинциальной школы из трёх человек решает дойти до национального турнира. Тренер — бывший чемпион, который ненавидит бадминтон.",
    chapters: 14, tags: [["plot-tournament", 3], ["hero-ensemble", 2], ["theme-friendship", 3], ["hero-growth", 2], ["mood-warm", 2], ["plot-school", 2]],
    characters: [["Кайто Ямасита", "main", "Капитан, который только учится", "🏸"], ["Тренер Аримура", "supporting", "Бывший чемпион страны", "🏆"]]
  },
  {
    title: "Ткачиха звёздных нитей", originalTitle: "Xingsi Zhinü", type: "manhua", year: 2023, status: "ongoing", rating: 8.5, releaseDay: 3,
    genres: ["Фэнтези", "Романтика", "Приключения"], author: "Чжао Минь", symbol: "✧", colors: ["#140f33", "#5a3ebf", "#ffd7f5"],
    description: "Небесная ткачиха теряет память и попадает в мир смертных. Каждая сотканная ею нить меняет чью-то судьбу, и демоны начинают охоту.",
    chapters: 18, tags: [["hero-female", 3], ["theme-love", 2], ["setting-other-world", 2], ["mood-mysterious", 2], ["theme-identity", 3], ["theme-cultivation", 1]],
    characters: [["Чжи Нюй", "main", "Небесная ткачиха", "✧"], ["Лэй Мин", "supporting", "Охотник на демонов", "🏹"]]
  },
  {
    title: "Слабейший маг Сумеречной башни", originalTitle: "Hwanghon Tap-ui Choeyak Mabeopsa", type: "manhwa", year: 2019, status: "completed", rating: 8.9,
    genres: ["Фэнтези", "Экшен", "Драма"], author: "Ли Мин Сок", symbol: "🜂", colors: ["#1a0f24", "#7a2f8f", "#ffb36b"],
    description: "Маг с худшим даром в башне раз за разом погибает и возвращается в день вступительного экзамена. С каждой петлёй он узнаёт, кто виноват в падении башни.",
    chapters: 28, tags: [["plot-time-loop", 3], ["hero-growth", 3], ["setting-academy", 2], ["mood-dark", 2], ["plot-twist", 3], ["theme-power", 2], ["mood-tragic", 2]],
    characters: [["Эйден Грейс", "main", "Маг, застрявший во времени", "🜂"], ["Архимаг Серафина", "antagonist", "Хранительница башни", "🔮"]]
  },
  {
    title: "Котик и я: дневник соседей", originalTitle: "Neko to Watashi", type: "manga", year: 2024, status: "ongoing", rating: 7.8, releaseDay: 6,
    genres: ["Повседневность", "Комедия"], author: "Юи Хамада", symbol: "🐱", colors: ["#2b2118", "#a0784f", "#ffe8c7"],
    description: "Офисная работница и уличный кот делят одну квартиру и одну подушку. Короткие главы о маленьких победах и больших переменах.",
    chapters: 10, tags: [["mood-cozy", 3], ["mood-funny", 2], ["mood-warm", 3], ["hero-ordinary", 3], ["setting-modern-city", 1]],
    characters: [["Акари Нисино", "main", "Офисная работница", "☕"], ["Мандарин", "supporting", "Кот с характером", "🐱"]]
  },
  {
    title: "Вторая жизнь мастера клинка", originalTitle: "Jian Sheng Chongsheng", type: "manhua", year: 2018, status: "completed", rating: 8.3,
    genres: ["Боевые искусства", "Экшен", "Исторический"], author: "Сюй Тянь", symbol: "剑", colors: ["#121a26", "#3a5f8c", "#c5e0ff"],
    description: "Величайший мечник Поднебесной погибает от предательства и просыпается двадцатилетним учеником. Он знает, кто предаст, но не знает зачем.",
    chapters: 26, tags: [["hero-reincarnated", 3], ["hero-overpowered", 2], ["plot-revenge", 3], ["setting-ancient-china", 3], ["theme-cultivation", 2], ["plot-tournament", 2], ["theme-redemption", 1]],
    characters: [["Сяо Фэн", "main", "Мастер клинка во второй жизни", "剑"], ["Ли Цзинь", "antagonist", "Названый брат", "🐍"]]
  },
  {
    title: "Астронавт с улицы Сакура", originalTitle: "Sakura-dōri no Uchūhikōshi", type: "manga", year: 2021, status: "completed", rating: 8.6,
    genres: ["Фантастика", "Драма", "Повседневность"], author: "Мэгуми Исикава", symbol: "🚀", colors: ["#0b1430", "#3c5ec4", "#ffc6e3"],
    description: "Пенсионерка решает исполнить мечту детства и попасть в отряд космонавтов. Внук помогает ей готовиться к отбору, который не проходил никто старше сорока.",
    chapters: 16, tags: [["setting-space", 2], ["theme-family", 3], ["mood-warm", 3], ["hero-ordinary", 2], ["theme-identity", 2], ["mood-melancholic", 1]],
    characters: [["Тиё Сакураи", "main", "Будущая космонавтка 72 лет", "🚀"], ["Рику Сакураи", "supporting", "Внук и тренер", "📡"]]
  }
];

// Связи из админки: [название, название, вид]
export const RELATIONS = [
  ["Хроники Шестых Врат", "Рыцарь, которого не призывали", "same_universe"],
  ["Код небесного дракона", "Песнь ледяного перевала", "same_universe"]
];

// Голосования без голосов: результаты появятся, когда проголосуют люди
export const POLLS = [
  {
    kind: "character", question: "Лучший главный герой осени",
    description: "Голосуют читатели ENDEMION. Один голос, его можно перенести, пока голосование открыто.",
    characters: ["Рэн Кагэяма", "Хан Сэ Мин", "Е Чэнь", "Эйден Грейс", "Леонора Эшфорд"]
  },
  { kind: "genre", question: "Какой жанр читать этой зимой?", genres: ["Фэнтези", "Романтика", "Ужасы", "Повседневность", "Детектив"] },
  { kind: "versus", question: "Кто сильнее: Хан Сэ Мин или Сяо Фэн?", characters: ["Хан Сэ Мин", "Сяо Фэн"] }
];
