// The starting plan for the handover: tasks, open decisions and the briefing
// the AI guide reads. Loaded once from the Plan page («Загрузить стартовый
// план»); afterwards everything lives in the database and is edited there.
// Dates are only set where a lead time forces them — the owner sets the rest.

export interface SeedTask {
  key: string;
  stream: string;
  title: string;
  titleEn: string;
  details?: string;
  detailsEn?: string;
  priority?: "URGENT" | "HIGH" | "NORMAL";
  due?: string;
  dependsOn?: string;
}

export const STARTING_TASKS: SeedTask[] = [
  // ── agreement with Fargo
  {
    key: "agr-1",
    stream: "agreement",
    title: "Письменное соглашение с Fargo о передаче дистрибуции",
    titleEn: "Written handover agreement with Fargo",
    details: "Управление к TI, доля Fargo 50% сохраняется, договоры с розницей переходят, персонал и машины остаются у Fargo, Fargo продаёт в регионе до даты его перехода.",
    detailsEn: "Control to TI, Fargo keeps its 50%, retail contracts transfer, staff and vehicles stay with Fargo, Fargo sells in a region until its switch date.",
    priority: "HIGH",
    due: "2026-10-31",
  },
  {
    key: "agr-2",
    stream: "agreement",
    title: "Подтвердить письменно сумму долга Fargo и график платежей",
    titleEn: "Confirm Fargo's balance and payment schedule in writing",
    priority: "HIGH",
    due: "2026-10-31",
  },
  {
    key: "agr-3",
    stream: "agreement",
    title: "Получить от Fargo список торговых точек с контактами по регионам",
    titleEn: "Get Fargo's outlet list with contacts by region",
    priority: "HIGH",
    due: "2026-10-24",
  },
  {
    key: "agr-4",
    stream: "agreement",
    title: "Получить от Fargo остатки Humana по SKU, партиям, срокам и складам (включая филиалы)",
    titleEn: "Get Fargo's Humana stock by SKU, batch, expiry and location (incl. branches)",
    details: "Отдельно показать товар, полученный до августа 2025 — он не входит в выкуп.",
    detailsEn: "Show stock received before August 2025 separately — it is outside the buyback.",
    priority: "HIGH",
    due: "2026-10-24",
  },
  {
    key: "agr-5",
    stream: "agreement",
    title: "Согласовать цену и способ оплаты выкупа остатков",
    titleEn: "Agree the buyback price and how it is paid",
    due: "2026-11-15",
  },
  {
    key: "agr-6",
    stream: "agreement",
    title: "Порядок на дату перехода: открытые заказы, возвраты, дебиторка точек перед Fargo",
    titleEn: "Switch-day rules: open orders, returns, outlets' debts to Fargo",
    due: "2026-11-15",
  },
  // ── chains (lead time 1–2 months)
  {
    key: "ch-1",
    stream: "chains",
    title: "Korzinka: начать регистрацию TI поставщиком Humana",
    titleEn: "Korzinka: start registering TI as the Humana supplier",
    details: "Срок оформления 1–2 месяца — от него зависит январский запуск.",
    detailsEn: "Takes 1–2 months — the January go-live depends on it.",
    priority: "URGENT",
    due: "2026-10-20",
  },
  {
    key: "ch-2",
    stream: "chains",
    title: "Makro: начать регистрацию TI поставщиком Humana",
    titleEn: "Makro: start registering TI as the Humana supplier",
    priority: "URGENT",
    due: "2026-10-20",
  },
  {
    key: "ch-3",
    stream: "chains",
    title: "Uzum: оформить TI поставщиком/продавцом Humana",
    titleEn: "Uzum: set TI up as the Humana supplier/seller",
    priority: "URGENT",
    due: "2026-10-20",
  },
  {
    key: "ch-4",
    stream: "chains",
    title: "Остальные сети из реестра точек: список и старт регистрации",
    titleEn: "Other chains in the outlet register: list them and start registration",
    priority: "HIGH",
    due: "2026-10-31",
  },
  {
    key: "ch-5",
    stream: "chains",
    title: "Условия для сетей в договорах: отсрочка 45–60 дней, ретро-бонусы",
    titleEn: "Chain terms in the contracts: 45–60 days credit, retro bonuses",
    details: "Ретро сейчас не оформлено договорами — закрепить ставки письменно.",
    detailsEn: "Retro is not in any contract today — put the rates in writing.",
    priority: "HIGH",
    due: "2026-11-15",
  },
  {
    key: "ch-6",
    stream: "chains",
    title: "День перехода по каждой сети: последняя поставка Fargo, первая поставка TI",
    titleEn: "Switch day for each chain: last Fargo delivery, first TI delivery",
    dependsOn: "ch-1",
  },
  // ── regions and dealers
  {
    key: "rg-1",
    stream: "regions",
    title: "Задать маршрут и дату перехода для каждого региона",
    titleEn: "Set the route and switch date for every region",
    details: "Страница «Регионы». Ташкент — после того, как процесс проверен в меньшем регионе.",
    detailsEn: "Regions page. Tashkent is best moved once the flow is proven in a smaller region.",
    priority: "HIGH",
    due: "2026-10-31",
  },
  {
    key: "rg-2",
    stream: "regions",
    title: "Ферганская долина: условия Humana с дилерами Nutriben (Андижан, Наманган, Фергана)",
    titleEn: "Fergana Valley: Humana terms with the Nutriben dealers (Andijon, Namangan, Fergana)",
  },
  {
    key: "rg-3",
    stream: "regions",
    title: "Ферганская долина: передать дилерам точки и остатки филиалов Fargo",
    titleEn: "Fergana Valley: hand Fargo's branch outlets and stock to the dealers",
    dependsOn: "rg-2",
  },
  {
    key: "rg-4",
    stream: "regions",
    title: "Остальные регионы: переговоры с дилерами Fargo, решение по каждому региону",
    titleEn: "Other regions: talk to Fargo's dealers and decide region by region",
  },
  {
    key: "rg-5",
    stream: "regions",
    title: "Шаблон дилерского договора: цена, отсрочка, территория, ежемесячный отчёт о продажах",
    titleEn: "Dealer agreement template: price, credit, territory, monthly sales report",
  },
  // ── outlets
  {
    key: "ou-1",
    stream: "outlets",
    title: "Собрать реестр точек из продаж 1С Fargo (в этом приложении)",
    titleEn: "Build the outlet register from Fargo's 1C sales (in this app)",
    priority: "HIGH",
    due: "2026-10-20",
  },
  {
    key: "ou-2",
    stream: "outlets",
    title: "Внести контакты и тип каждой точки",
    titleEn: "Fill in each outlet's contact and type",
    dependsOn: "agr-3",
  },
  {
    key: "ou-3",
    stream: "outlets",
    title: "Шаблон договора поставки для розницы и кредитная политика",
    titleEn: "Supply agreement template for retail and the credit policy",
  },
  {
    key: "ou-4",
    stream: "outlets",
    title: "Письмо клиентам о смене поставщика от TI и Fargo (RU/UZ)",
    titleEn: "Letter to customers on the change of supplier from TI and Fargo (RU/UZ)",
    dependsOn: "cm-1",
  },
  {
    key: "ou-5",
    stream: "outlets",
    title: "Подписать договоры со всеми активными точками до даты перехода их региона",
    titleEn: "Sign every active outlet before its region's switch date",
    dependsOn: "ou-3",
  },
  // ── stock
  {
    key: "st-1",
    stream: "stock",
    title: "Сверить остатки Fargo с учётными остатками в приложении",
    titleEn: "Reconcile Fargo's stock list with the app's book stock",
    dependsOn: "agr-4",
  },
  {
    key: "st-2",
    stream: "stock",
    title: "Короткий срок годности: план распродажи или списания до выкупа",
    titleEn: "Short-dated stock: sell-through or write-off plan before the buyback",
    dependsOn: "agr-4",
  },
  {
    key: "st-3",
    stream: "stock",
    title: "Совместный пересчёт Fargo + TI на дату перехода каждого региона",
    titleEn: "Joint Fargo + TI count at each region's switch date",
  },
  {
    key: "st-4",
    stream: "stock",
    title: "Документы выкупа (возврат / акт) и перевозка на склад Union Invest",
    titleEn: "Buyback documents (return / act) and transport to the Union Invest warehouse",
    dependsOn: "agr-5",
  },
  // ── SmartUp and operations
  {
    key: "op-1",
    stream: "operations",
    title: "Отдельная база SmartUp для Humana: товары, цены, склад, пользователи",
    titleEn: "Separate SmartUp base for Humana: products, prices, warehouse, users",
    priority: "URGENT",
    due: "2026-11-30",
  },
  {
    key: "op-2",
    stream: "operations",
    title: "Загрузить клиентов в SmartUp с условиями кредита",
    titleEn: "Load customers into SmartUp with their credit terms",
    dependsOn: "op-1",
  },
  {
    key: "op-3",
    stream: "operations",
    title: "Склад Union Invest: место и приёмка под Humana",
    titleEn: "Union Invest warehouse: space and receiving for Humana",
  },
  {
    key: "op-4",
    stream: "operations",
    title: "Доставка по Ташкенту: маршруты и транспорт",
    titleEn: "Tashkent delivery: routes and vehicles",
    details: "Машины Fargo остаются у Fargo.",
    detailsEn: "Fargo's vehicles stay with Fargo.",
  },
  {
    key: "op-5",
    stream: "operations",
    title: "Бэк-офис: электронные счета-фактуры, инкассация, касса, связь с 1С TI",
    titleEn: "Back office: e-invoices, collections, cash desk, link to TI's 1C",
  },
  {
    key: "op-6",
    stream: "operations",
    title: "Тест полного цикла в SmartUp до первого перехода: заказ → доставка → счёт → оплата",
    titleEn: "Test the full SmartUp cycle before the first switch: order → delivery → invoice → payment",
    priority: "HIGH",
    dependsOn: "op-1",
  },
  // ── team
  {
    key: "tm-1",
    stream: "team",
    title: "Нанять 2 торговых агентов в Ташкенте до перехода Ташкента",
    titleEn: "Hire 2 Tashkent sales agents before Tashkent switches",
  },
  {
    key: "tm-2",
    stream: "team",
    title: "Планы, мотивация и обучение агентов по ассортименту Humana",
    titleEn: "Agent targets, pay and Humana product training",
    dependsOn: "tm-1",
  },
  {
    key: "tm-3",
    stream: "team",
    title: "Связать медпредставителей с торговлей по территориям",
    titleEn: "Align the MR team with trade by territory",
  },
  // ── finance
  {
    key: "fi-1",
    stream: "finance",
    title: "План оборотного капитала: отсрочка сетям + выкуп → потребность в деньгах по месяцам",
    titleEn: "Working-capital plan: chain credit + buyback → cash needed by month",
    priority: "HIGH",
    due: "2026-11-15",
  },
  {
    key: "fi-2",
    stream: "finance",
    title: "Старение дебиторки и порядок инкассации с первого дня",
    titleEn: "Receivables ageing and a collection routine from day one",
    details: "У Fargo был рычаг других брендов — ожидать более медленную оплату.",
    detailsEn: "Fargo had the leverage of its other brands — expect slower payment.",
  },
  {
    key: "fi-3",
    stream: "finance",
    title: "Ежемесячный отчёт для Fargo как партнёра 50%",
    titleEn: "Monthly report for Fargo as the 50% partner",
  },
  {
    key: "fi-4",
    stream: "finance",
    title: "Отслеживать платежи Fargo по расчёту каждый месяц",
    titleEn: "Track Fargo's settlement payments every month",
  },
  // ── communication
  {
    key: "cm-1",
    stream: "comms",
    title: "Сообщить Humana HQ (DMK) до того, как узнают клиенты",
    titleEn: "Inform Humana HQ (DMK) before customers hear",
    priority: "HIGH",
    due: "2026-11-15",
  },
  {
    key: "cm-2",
    stream: "comms",
    title: "Брифинг команды медпредставителей",
    titleEn: "Brief the MR team",
  },
  // ── this app
  {
    key: "ap-1",
    stream: "app",
    title: "Загружать продажи TI (выгрузки SmartUp) по переведённым регионам",
    titleEn: "Bring in TI's own sales (SmartUp exports) for switched regions",
  },
  {
    key: "ap-2",
    stream: "app",
    title: "Изменить учёт выручки и расчёт с Fargo для переведённых регионов",
    titleEn: "Change revenue and the Fargo settlement for switched regions",
    details: "Модель «Fargo собирает — Fargo перечисляет» заканчивается там, где продаёт TI.",
    detailsEn: "The 'Fargo collects, Fargo remits' model ends where TI sells.",
  },
];

export interface SeedDecision {
  key: string;
  topic: string;
  topicEn: string;
  options?: string;
  decision?: string;
  due?: string;
}

export const STARTING_DECISIONS: SeedDecision[] = [
  {
    key: "dc-1",
    topic: "Оплата выкупа остатков",
    topicEn: "How the stock buyback is paid",
    options: "Зачёт против долга Fargo · деньгами · смешанно / Offset against Fargo's balance · cash · mixed",
    due: "2026-11-15",
  },
  {
    key: "dc-2",
    topic: "Цена выкупа",
    topicEn: "Buyback price basis",
    options: "Последняя цена счёта TI→Fargo · себестоимость TI / Latest TI→Fargo invoice price · TI cost",
    due: "2026-11-15",
  },
  {
    key: "dc-3",
    topic: "Порядок и даты перехода регионов",
    topicEn: "Order and dates of the region switches",
    due: "2026-10-31",
  },
  {
    key: "dc-4",
    topic: "Маршрут для регионов вне Ферганской долины",
    topicEn: "Route for the regions outside the Fergana Valley",
    options: "Дилер Fargo напрямую · дилер Nutriben — по каждому региону / Fargo's dealer direct · Nutriben dealer — per region",
  },
  {
    key: "dc-5",
    topic: "Кредитная политика для традиционной розницы",
    topicEn: "Credit policy for traditional retail",
    options: "Лимит, срок, предоплата для новых / Limit, days, prepayment for new outlets",
  },
  {
    key: "dc-6",
    topic: "Кредит точкам на старте",
    topicEn: "Outlet credit at the start",
    decision: "С чистого листа: долги точек перед Fargo остаются у Fargo / Clean start: outlets' debts to Fargo stay with Fargo",
  },
  {
    key: "dc-7",
    topic: "Ферганская долина",
    topicEn: "Fergana Valley",
    decision: "Филиалы Fargo в Андижане, Намангане и Фергане переходят к дилерам Nutriben / Fargo's branches move to the Nutriben dealers",
  },
  {
    key: "dc-8",
    topic: "Торговая команда",
    topicEn: "Sales team",
    decision: "Торговых представителей Fargo не нанимаем; около 2 новых агентов TI в Ташкенте / Fargo's reps are not hired; about 2 new TI agents in Tashkent",
  },
];

/** What the AI guide is told about the handover. Editable on the overview page. */
export const DEFAULT_BRIEF = `Переход дистрибуции Humana от Fargo к Turbo Impex (TI):
- Согласованный переход, не спор. Fargo остаётся партнёром 50/50 и сотрудничает; управление дистрибуцией переходит к TI. Акционеры одобрили. Fargo платит всё, что должен по расчёту.
- Поэтапно, регион за регионом; цель — новая структура с января 2027. Порядок и даты задаются на странице «Регионы». До даты перехода региона Fargo продаёт там как сейчас.
- Договоры Fargo с розницей переходят к TI; торговые представители и машины Fargo — нет. Нужно около 2 новых агентов TI в Ташкенте. Команда медпредставителей не меняется.
- Ферганская долина (филиалы Fargo в Андижане, Намангане, Фергане): Humana берут дилеры Nutriben. Остальные регионы работают через дилеров Fargo — решение по каждому региону.
- Сети (Korzinka, Makro, Uzum и др.): TI регистрируется поставщиком заново, это 1–2 месяца. Отсрочка сетям 45–60 дней.
- Со всеми точками — новые договоры с TI. Кредит с чистого листа. Инкассация, скорее всего, ухудшится: у Fargo был рычаг других брендов.
- Цены Humana задаёт TI, они не меняются.
- Торговля Humana ведётся в отдельной новой базе SmartUp. Склад и бэк-офис Union Invest принимают Humana.
- TI выкупает остатки Humana у Fargo. Товар Fargo, полученный до августа 2025, — собственный Fargo и в выкуп не входит. Цена и способ оплаты выкупа ещё не решены.
- Humana HQ (DMK) ещё не проинформирован.
- План пока ведёт сам владелец; задачи без исполнителя — его.`;

/** Default route and kind for a sales channel, read from its name. All editable. */
export function regionDefaults(name: string): { kind: string; route: string } {
  const n = name.toLowerCase();
  if (/korzinka|корзинк|makro|макро|uzum|узум|havas|хавас|retail|market|маркет|bi1|darvoza|сет[ьи]\b|chain/.test(n)) {
    return { kind: "CHAIN", route: "CHAIN_DIRECT" };
  }
  if (/внутрен|прочи|офис|магазин fargo|хумана|other|internal|дилер|оптом|\bопт\b|wholesale/.test(n)) {
    return { kind: "OTHER", route: "UNDECIDED" };
  }
  // Fargo's own branches in the Fergana Valley go to the Nutriben dealers
  if (/андижан|andij|наманган|namangan|^фергана|fergana|ferghana|farg/.test(n)) {
    return { kind: "REGION", route: "NUTRIBEN_DEALER" };
  }
  return { kind: "REGION", route: "UNDECIDED" };
}
