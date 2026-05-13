import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  BadgePercent,
  BarChart3,
  BookOpen,
  Coins,
  Database,
  Edit3,
  FileText,
  Home,
  LineChart,
  ListChecks,
  Moon,
  PieChart,
  Plus,
  RefreshCw,
  Scale,
  Sun,
  Trash2,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Holding = {
  id: number;
  name: string;
  costPrice: number;
  currentPrice: number;
  quantity: number;
};

type HoldingStats = Holding & {
  totalCost: number;
  currentValue: number;
  profit: number;
  profitRate: number;
};

type RebalanceRow = HoldingStats & {
  costRatio: number;
  valueRatio: number;
  targetValue: number;
  delta: number;
  deltaQty: number;
  color: string;
};

type ToastItem = {
  id: number;
  message: string;
  type: "success" | "error" | "info";
};

type ThemeMode = "light" | "dark";
type PageMode = "dashboard" | "guide";

type StoredPortfolio = {
  id: "portfolio";
  holdings: Holding[];
  nextId: number;
  updatedAt: string;
};

const palette = [
  "#0f766e",
  "#0e7490",
  "#ca8a04",
  "#2563eb",
  "#db2777",
  "#16a34a",
  "#7c3aed",
  "#ea580c",
];

const legacySampleHoldings: Holding[] = [
  { id: 1, name: "沪深300ETF", costPrice: 3.85, currentPrice: 4.12, quantity: 10000 },
  { id: 2, name: "中证500ETF", costPrice: 6.52, currentPrice: 5.89, quantity: 5000 },
  { id: 3, name: "纳斯达克ETF", costPrice: 1.85, currentPrice: 2.36, quantity: 20000 },
  { id: 4, name: "黄金ETF", costPrice: 5.12, currentPrice: 5.98, quantity: 8000 },
];

const initialHoldings: Holding[] = [];

const emptyForm = {
  name: "",
  costPrice: "",
  currentPrice: "",
  quantity: "",
};

const DB_NAME = "portfolio-rebalance";
const DB_VERSION = 1;
const STORE_NAME = "portfolio";
const PORTFOLIO_KEY = "portfolio";

function getSystemTheme(): ThemeMode {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }

  return "light";
}

function isHolding(value: unknown): value is Holding {
  if (!value || typeof value !== "object") return false;

  const item = value as Holding;

  return (
    Number.isInteger(item.id) &&
    typeof item.name === "string" &&
    Number.isFinite(item.costPrice) &&
    Number.isFinite(item.currentPrice) &&
    Number.isInteger(item.quantity)
  );
}

function getNextHoldingId(holdings: Holding[]) {
  return holdings.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

function isSameHolding(left: Holding, right: Holding) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.costPrice === right.costPrice &&
    left.currentPrice === right.currentPrice &&
    left.quantity === right.quantity
  );
}

function isLegacySamplePortfolio(holdings: Holding[]) {
  return (
    holdings.length === legacySampleHoldings.length &&
    holdings.every((holding, index) =>
      isSameHolding(holding, legacySampleHoldings[index]),
    )
  );
}

function openPortfolioDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("当前浏览器不支持 IndexedDB"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("打开本地数据库失败"));
  });
}

function idbRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("本地数据库操作失败"));
  });
}

async function readStoredPortfolio() {
  const db = await openPortfolioDb();

  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const stored = await idbRequest<StoredPortfolio | undefined>(
      store.get(PORTFOLIO_KEY),
    );

    if (!stored || !Array.isArray(stored.holdings)) return null;

    const holdings = stored.holdings.filter(isHolding);

    if (isLegacySamplePortfolio(holdings)) {
      return {
        holdings: initialHoldings,
        nextId: 1,
      };
    }

    return {
      holdings,
      nextId: Math.max(stored.nextId || 1, getNextHoldingId(holdings)),
    };
  } finally {
    db.close();
  }
}

async function writeStoredPortfolio(holdings: Holding[], nextId: number) {
  const db = await openPortfolioDb();

  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    await idbRequest(
      store.put({
        id: PORTFOLIO_KEY,
        holdings,
        nextId,
        updatedAt: new Date().toISOString(),
      } satisfies StoredPortfolio),
    );
  } finally {
    db.close();
  }
}

function formatMoney(value: number) {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function getHoldingStats(holding: Holding): HoldingStats {
  const totalCost = holding.costPrice * holding.quantity;
  const currentValue = holding.currentPrice * holding.quantity;
  const profit = currentValue - totalCost;
  const profitRate =
    holding.costPrice > 0
      ? (holding.currentPrice - holding.costPrice) / holding.costPrice
      : 0;

  return { ...holding, totalCost, currentValue, profit, profitRate };
}

function summarize(data: HoldingStats[]) {
  const totalCost = data.reduce((sum, item) => sum + item.totalCost, 0);
  const totalValue = data.reduce((sum, item) => sum + item.currentValue, 0);
  const totalProfit = totalValue - totalCost;
  const totalRate = totalCost > 0 ? totalProfit / totalCost : 0;

  return { totalCost, totalValue, totalProfit, totalRate };
}

function signed(value: number, formatter = formatMoney) {
  return `${value >= 0 ? "+" : ""}${formatter(value)}`;
}

function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => getSystemTheme());
  const [page, setPage] = useState<PageMode>("dashboard");
  const [holdings, setHoldings] = useState<Holding[]>(initialHoldings);
  const [nextId, setNextId] = useState(1);
  const [storageReady, setStorageReady] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [result, setResult] = useState<{
    rows: RebalanceRow[];
    deviation: number;
  } | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const stats = useMemo(() => holdings.map(getHoldingStats), [holdings]);
  const totals = useMemo(() => summarize(stats), [stats]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = (event: MediaQueryListEvent) => {
      setTheme(event.matches ? "dark" : "light");
    };

    media.addEventListener("change", syncSystemTheme);

    return () => {
      media.removeEventListener("change", syncSystemTheme);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    readStoredPortfolio()
      .then((stored) => {
        if (cancelled) return;

        if (stored) {
          setHoldings(stored.holdings);
          setNextId(stored.nextId);
        }

        setStorageReady(true);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setStorageReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;

    writeStoredPortfolio(holdings, nextId).catch((error: unknown) => {
      console.error(error);
    });
  }, [holdings, nextId, storageReady]);

  useEffect(() => {
    if (result) {
      window.setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
  }, [result]);

  const pushToast = (message: string, type: ToastItem["type"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 3200);
  };

  const openAddDialog = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
    setDialogOpen(true);
  };

  const openEditDialog = (holding: Holding) => {
    setEditingId(holding.id);
    setForm({
      name: holding.name,
      costPrice: String(holding.costPrice),
      currentPrice: String(holding.currentPrice),
      quantity: String(holding.quantity),
    });
    setFormError("");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setFormError("");
  };

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (formError) setFormError("");
  };

  const submitHolding = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    const costPrice = Number(form.costPrice);
    const currentPrice = Number(form.currentPrice);
    const quantity = Number.parseInt(form.quantity, 10);

    if (!name) {
      setFormError("请输入产品名称");
      return;
    }
    if (!Number.isFinite(costPrice) || costPrice <= 0) {
      setFormError("成本单价必须大于 0");
      return;
    }
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      setFormError("当前价格必须大于 0");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      setFormError("持仓数量必须为正整数");
      return;
    }

    if (editingId) {
      setHoldings((items) =>
        items.map((item) =>
          item.id === editingId
            ? { ...item, name, costPrice, currentPrice, quantity }
            : item,
        ),
      );
      pushToast(`已更新：${name}`, "success");
    } else {
      setHoldings((items) => [
        ...items,
        { id: nextId, name, costPrice, currentPrice, quantity },
      ]);
      setNextId((id) => id + 1);
      pushToast(`已添加：${name}`, "success");
    }

    setResult(null);
    closeDialog();
  };

  const deleteHolding = (holding: Holding) => {
    setHoldings((items) => items.filter((item) => item.id !== holding.id));
    setResult(null);
    pushToast(`已删除：${holding.name}`, "info");
  };

  const runRebalance = () => {
    if (holdings.length < 2) {
      pushToast("至少需要 2 个持仓产品才能进行再平衡分析", "error");
      return;
    }

    if (totals.totalCost === 0 || totals.totalValue === 0) {
      pushToast("总成本或总市值为零，无法计算", "error");
      return;
    }

    const rows = stats.map((item, index) => {
      const costRatio = item.totalCost / totals.totalCost;
      const valueRatio = item.currentValue / totals.totalValue;
      const targetValue = totals.totalValue * costRatio;
      const delta = targetValue - item.currentValue;
      const deltaQty = item.currentPrice > 0 ? delta / item.currentPrice : 0;

      return {
        ...item,
        costRatio,
        valueRatio,
        targetValue,
        delta,
        deltaQty,
        color: palette[index % palette.length],
      };
    });

    const deviation =
      rows.reduce(
        (sum, item) => sum + Math.abs(item.valueRatio - item.costRatio),
        0,
      ) / 2;

    setResult({ rows, deviation });
  };

  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };

  return (
    <main className="surface-band min-h-screen">
      <ThemeButton theme={theme} onToggle={toggleTheme} />
      <ToastLayer toasts={toasts} />

      <HoldingDialog
        open={dialogOpen}
        editing={editingId !== null}
        form={form}
        error={formError}
        onOpenChange={setDialogOpen}
        onFieldChange={updateField}
        onSubmit={submitHolding}
      />

      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-8 sm:px-6 sm:py-10">
        {page === "dashboard" ? (
          <DashboardPage
            stats={stats}
            totals={totals}
            result={result}
            resultRef={resultRef}
            onAdd={openAddDialog}
            onEdit={openEditDialog}
            onDelete={deleteHolding}
            onRunRebalance={runRebalance}
            onOpenGuide={() => setPage("guide")}
            storageReady={storageReady}
          />
        ) : (
          <UsageGuide onBack={() => setPage("dashboard")} />
        )}

        <footer className="mt-12 border-t pt-6 text-center text-xs text-muted-foreground">
          投资有风险，本工具仅供参考，不构成投资建议。
        </footer>
      </div>
    </main>
  );
}

function ThemeButton({
  theme,
  onToggle,
}: {
  theme: ThemeMode;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onToggle}
      aria-label={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
      title={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
      className="fixed right-4 top-4 z-50 bg-card shadow-panel"
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}

function DashboardPage({
  stats,
  totals,
  result,
  resultRef,
  storageReady,
  onAdd,
  onEdit,
  onDelete,
  onRunRebalance,
  onOpenGuide,
}: {
  stats: HoldingStats[];
  totals: ReturnType<typeof summarize>;
  result: { rows: RebalanceRow[]; deviation: number } | null;
  resultRef: React.MutableRefObject<HTMLDivElement | null>;
  storageReady: boolean;
  onAdd: () => void;
  onEdit: (holding: Holding) => void;
  onDelete: (holding: Holding) => void;
  onRunRebalance: () => void;
  onOpenGuide: () => void;
}) {
  return (
    <>
      <header className="mb-8 flex flex-col gap-5 border-b pb-8 pr-12 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm font-medium text-muted-foreground">
            <Scale className="h-4 w-4 text-primary" />
            Portfolio Rebalance
          </div>
          <h1 className="text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
            投资组合再平衡策略
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            按初始成本比例计算目标市值，快速判断每个产品需要买入或卖出的金额与数量。
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs font-medium text-muted-foreground">
            <Database className="h-4 w-4 text-primary" />
            {storageReady
              ? "数据会自动保存到当前浏览器本地"
              : "正在读取本地保存的数据"}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={onOpenGuide}>
            <BookOpen className="h-4 w-4" />
            使用说明
          </Button>
          <Button variant="outline" onClick={onAdd}>
            <Plus className="h-4 w-4" />
            添加持仓
          </Button>
          <Button onClick={onRunRebalance} disabled={stats.length < 2}>
            <RefreshCw className="h-4 w-4" />
            执行再平衡分析
          </Button>
        </div>
      </header>

      <SummaryGrid totals={totals} holdingsCount={stats.length} />

      <section className="mt-8" aria-label="持仓明细">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <ListChecks className="h-5 w-5 text-primary" />
              持仓明细
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              编辑价格或数量后，分析结果会自动清空以避免误读。
            </p>
          </div>
        </div>

        {stats.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stats.map((holding, index) => (
              <HoldingCard
                key={holding.id}
                holding={holding}
                color={palette[index % palette.length]}
                totalValue={totals.totalValue}
                onEdit={() => onEdit(holding)}
                onDelete={() => onDelete(holding)}
              />
            ))}
          </div>
        ) : (
          <EmptyState onAdd={onAdd} />
        )}
      </section>

      {result ? (
        <ResultSection
          refNode={resultRef}
          rows={result.rows}
          deviation={result.deviation}
          totalCost={totals.totalCost}
          totalValue={totals.totalValue}
        />
      ) : null}
    </>
  );
}

function UsageGuide({ onBack }: { onBack: () => void }) {
  const steps = [
    {
      title: "录入持仓",
      content:
        "点击“添加持仓”录入自己的产品名称、成本单价、当前价格和持仓数量。页面不会预置示例持仓，避免和真实数据混淆。",
    },
    {
      title: "维护数据",
      content:
        "在持仓卡片右下角可以编辑或删除产品。修改价格或数量后，已有分析结果会清空，避免使用旧结果做判断。",
    },
    {
      title: "执行分析",
      content:
        "至少保留两个持仓后，点击“执行再平衡分析”。工具会按初始成本比例计算各产品目标市值，并给出买入或卖出建议。",
    },
    {
      title: "查看结果",
      content:
        "结果区包含组合偏离度、成本比例与当前比例图表、调整建议明细，以及当前市值和目标市值对比。",
    },
  ];

  const features = [
    "组合汇总：展示总成本、当前市值、总盈亏和收益率。",
    "持仓管理：支持新增、编辑、删除持仓产品。",
    "比例对比：用图表比较初始成本比例和当前市值比例。",
    "再平衡建议：计算目标市值、调整金额和约需调整数量。",
    "本地存储：新增、编辑、删除后的持仓会自动保存到当前浏览器的 IndexedDB。",
    "主题切换：右上角按钮可在深色和浅色模式间切换。",
  ];

  return (
    <section className="space-y-6 pr-12">
      <header className="border-b pb-8">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          返回主页面
        </Button>
        <div className="mt-6 max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm font-medium text-muted-foreground">
            <FileText className="h-4 w-4 text-primary" />
            使用说明
          </div>
          <h1 className="text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
            如何使用再平衡工具
          </h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            这个页面用于估算投资组合是否偏离原始配置，并提供保持总市值不变的内部调仓建议。
          </p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-5 w-5 text-primary" />
              使用流程
            </CardTitle>
            <CardDescription>从录入数据到查看调仓建议的完整路径。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {steps.map((step, index) => (
              <div key={step.title} className="grid grid-cols-[32px_1fr] gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
                  {index + 1}
                </div>
                <div>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {step.content}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-primary" />
              功能范围
            </CardTitle>
            <CardDescription>当前工具覆盖的主要能力。</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
              {features.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            计算逻辑
          </CardTitle>
          <CardDescription>再平衡结果的含义和计算依据。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm leading-6 text-muted-foreground md:grid-cols-3">
          <div>
            <h3 className="mb-1 font-semibold text-foreground">成本比例</h3>
            <p>单个产品总成本除以组合总成本，作为目标配置比例。</p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-foreground">目标市值</h3>
            <p>组合当前总市值乘以该产品成本比例，得到再平衡后的目标金额。</p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-foreground">调整建议</h3>
            <p>目标市值减去当前市值。正数代表买入，负数代表卖出。</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            本地数据存储
          </CardTitle>
          <CardDescription>数据保存位置和默认数据说明。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            你的持仓数据只会保存到当前浏览器本地的 IndexedDB，不会上传到服务器，也不会在不同设备或不同浏览器之间同步。
          </p>
          <p>
            页面不会预置任何默认持仓。请从空列表开始录入自己的真实数据，避免把示例内容误认为个人资产。
          </p>
          <p>
            如果清理浏览器站点数据、使用无痕模式，或更换浏览器设备，本地保存的数据可能无法保留。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>注意事项</CardTitle>
          <CardDescription>使用结果前需要明确的限制。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            本工具只做组合内部再平衡估算，不考虑交易手续费、税费、申赎限制、最小交易单位、滑点和实时价格变化。
          </p>
          <p>
            “调整数量”为按当前价格四舍五入得到的近似值，真实交易时应结合产品规则和个人风险承受能力重新核对。
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function SummaryGrid({
  totals,
  holdingsCount,
}: {
  totals: ReturnType<typeof summarize>;
  holdingsCount: number;
}) {
  const items = [
    {
      label: "总成本",
      value: formatMoney(totals.totalCost),
      icon: Coins,
      tone: "text-primary",
    },
    {
      label: "当前市值",
      value: formatMoney(totals.totalValue),
      icon: Wallet,
      tone: "text-cyan-700 dark:text-cyan-300",
    },
    {
      label: "总盈亏",
      value: signed(totals.totalProfit),
      icon: LineChart,
      tone:
        totals.totalProfit >= 0
          ? "text-emerald-600 dark:text-emerald-300"
          : "text-red-600 dark:text-red-300",
    },
    {
      label: "收益率",
      value: signed(totals.totalRate, formatPercent),
      icon: BadgePercent,
      tone:
        totals.totalRate >= 0
          ? "text-emerald-600 dark:text-emerald-300"
          : "text-red-600 dark:text-red-300",
      detail: `${holdingsCount} 个产品`,
    },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="组合汇总">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.label} className="overflow-hidden">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>{item.label}</span>
                <Icon className={cn("h-4 w-4", item.tone)} />
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className={cn("tabular text-xl font-semibold sm:text-2xl", item.tone)}>
                {item.value}
              </div>
              {item.detail ? (
                <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

function HoldingCard({
  holding,
  color,
  totalValue,
  onEdit,
  onDelete,
}: {
  holding: HoldingStats;
  color: string;
  totalValue: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ratio = totalValue > 0 ? holding.currentValue / totalValue : 0;
  const positive = holding.profit >= 0;

  return (
    <Card className="overflow-hidden">
      <div className="h-1" style={{ backgroundColor: color }} />
      <CardHeader className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <CardTitle className="truncate">{holding.name}</CardTitle>
            </div>
            <CardDescription className="mt-2">
              当前占比 {formatPercent(ratio)}
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0",
              positive
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
            )}
          >
            {signed(holding.profitRate, formatPercent)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <MetricRow label="成本价" value={holding.costPrice.toFixed(3)} />
          <MetricRow label="现价" value={holding.currentPrice.toFixed(3)} />
          <MetricRow label="持仓数量" value={holding.quantity.toLocaleString("zh-CN")} />
          <MetricRow label="总成本" value={formatMoney(holding.totalCost)} />
          <MetricRow label="当前市值" value={formatMoney(holding.currentValue)} strong />
          <MetricRow
            label="盈亏金额"
            value={signed(holding.profit)}
            className={
              positive
                ? "text-emerald-600 dark:text-emerald-300"
                : "text-red-600 dark:text-red-300"
            }
          />
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(ratio * 100, 1)}%`, backgroundColor: color }}
          />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onEdit} aria-label={`编辑${holding.name}`}>
            <Edit3 className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            aria-label={`删除${holding.name}`}
            className="text-red-600 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricRow({
  label,
  value,
  strong,
  className,
}: {
  label: string;
  value: string;
  strong?: boolean;
  className?: string;
}) {
  return (
    <>
      <div className="text-muted-foreground">{label}</div>
      <div
        className={cn(
          "tabular text-right",
          strong ? "font-semibold text-foreground" : "font-medium",
          className,
        )}
      >
        {value}
      </div>
    </>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card/70 px-6 py-16 text-center">
      <PieChart className="mb-4 h-10 w-10 text-muted-foreground" />
      <h3 className="text-lg font-semibold">暂无持仓产品</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        添加至少两个产品后即可执行再平衡分析。
      </p>
      <Button className="mt-5" onClick={onAdd}>
        <Plus className="h-4 w-4" />
        添加持仓
      </Button>
    </div>
  );
}

function HoldingDialog({
  open,
  editing,
  form,
  error,
  onOpenChange,
  onFieldChange,
  onSubmit,
}: {
  open: boolean;
  editing: boolean;
  form: typeof emptyForm;
  error: string;
  onOpenChange: (open: boolean) => void;
  onFieldChange: (field: keyof typeof emptyForm, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "编辑持仓产品" : "添加持仓产品"}</DialogTitle>
          <DialogDescription>
            输入成本、现价和数量后，系统会自动计算市值与再平衡建议。
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="name">产品名称</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(event) => onFieldChange("name", event.target.value)}
              placeholder="如：沪深300ETF"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="costPrice">成本单价</Label>
              <Input
                id="costPrice"
                type="number"
                min="0.001"
                step="0.001"
                value={form.costPrice}
                onChange={(event) => onFieldChange("costPrice", event.target.value)}
                placeholder="0.000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currentPrice">当前价格</Label>
              <Input
                id="currentPrice"
                type="number"
                min="0.001"
                step="0.001"
                value={form.currentPrice}
                onChange={(event) => onFieldChange("currentPrice", event.target.value)}
                placeholder="0.000"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="quantity">持仓数量</Label>
            <Input
              id="quantity"
              type="number"
              min="1"
              step="1"
              value={form.quantity}
              onChange={(event) => onFieldChange("quantity", event.target.value)}
              placeholder="0"
            />
          </div>

          {error ? <p className="text-sm text-red-600 dark:text-red-300">{error}</p> : null}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">确认保存</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResultSection({
  refNode,
  rows,
  deviation,
  totalCost,
  totalValue,
}: {
  refNode: React.MutableRefObject<HTMLDivElement | null>;
  rows: RebalanceRow[];
  deviation: number;
  totalCost: number;
  totalValue: number;
}) {
  const devLevel = deviation < 0.05 ? "低偏离" : deviation < 0.15 ? "中偏离" : "高偏离";
  const devTone =
    deviation < 0.05
      ? "text-emerald-600 dark:text-emerald-300"
      : deviation < 0.15
        ? "text-amber-600 dark:text-amber-300"
        : "text-red-600 dark:text-red-300";

  return (
    <section ref={refNode} className="mt-10 space-y-6" aria-label="再平衡结果">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <BarChart3 className="h-6 w-6 text-primary" />
          再平衡分析结果
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          目标市值按初始总成本占比计算，买卖建议不改变组合总市值。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="p-5 pb-2">
            <CardTitle className="text-sm text-muted-foreground">组合偏离度</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-5 p-5 pt-0">
            <DeviationGauge deviation={deviation} />
            <div>
              <div className={cn("tabular text-2xl font-semibold", devTone)}>
                {(deviation * 100).toFixed(2)}%
              </div>
              <div className={cn("mt-1 font-medium", devTone)}>{devLevel}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-5 pb-2">
            <CardTitle className="text-sm text-muted-foreground">再平衡前总市值</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <div className="tabular text-2xl font-semibold">{formatMoney(totalValue)}</div>
            <p className="mt-2 text-xs text-muted-foreground">内部配比调整，合计保持不变。</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-5 pb-2">
            <CardTitle className="text-sm text-muted-foreground">需调整产品数</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <div className="tabular text-2xl font-semibold">
              {rows.filter((row) => Math.abs(row.delta) > 0.01).length}
              <span className="text-base font-normal text-muted-foreground"> / {rows.length}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              买入 {rows.filter((row) => row.delta > 0.01).length} 个，卖出{" "}
              {rows.filter((row) => row.delta < -0.01).length} 个。
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>初始成本比例</CardTitle>
            <CardDescription>以买入成本作为配置锚点。</CardDescription>
          </CardHeader>
          <CardContent>
            <DoughnutChart
              data={rows.map((row) => ({
                label: row.name,
                value: row.totalCost,
                color: row.color,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>当前市值比例</CardTitle>
            <CardDescription>用于对比当前偏离情况。</CardDescription>
          </CardHeader>
          <CardContent>
            <DoughnutChart
              data={rows.map((row) => ({
                label: row.name,
                value: row.currentValue,
                color: row.color,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <AdjustmentTable rows={rows} totalCost={totalCost} totalValue={totalValue} />
      <ValueBarChart rows={rows} />
    </section>
  );
}

function DeviationGauge({ deviation }: { deviation: number }) {
  const circumference = 2 * Math.PI * 42;
  const color =
    deviation < 0.05 ? "#16a34a" : deviation < 0.15 ? "#ca8a04" : "#dc2626";

  return (
    <svg className="h-24 w-24" viewBox="0 0 100 100" role="img" aria-label="组合偏离度">
      <circle
        cx="50"
        cy="50"
        r="42"
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth="9"
      />
      <circle
        cx="50"
        cy="50"
        r="42"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth="9"
        strokeDasharray={`${Math.min(deviation, 1) * circumference} ${circumference}`}
        transform="rotate(-90 50 50)"
      />
      <Activity className="h-5 w-5" x="38" y="38" color={color} />
    </svg>
  );
}

function DoughnutChart({
  data,
}: {
  data: { label: string; value: number; color: string }[];
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const circumference = 2 * Math.PI * 42;
  let offset = 0;

  return (
    <div className="grid gap-5 sm:grid-cols-[180px_1fr] sm:items-center">
      <svg className="mx-auto h-44 w-44" viewBox="0 0 100 100" role="img">
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="14"
        />
        {data.map((item) => {
          const share = total > 0 ? item.value / total : 0;
          const dash = share * circumference;
          const segment = (
            <circle
              key={item.label}
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke={item.color}
              strokeWidth="14"
              strokeDasharray={`${dash} ${circumference}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          );
          offset += dash;
          return segment;
        })}
        <circle cx="50" cy="50" r="28" fill="hsl(var(--card))" />
        <text
          x="50"
          y="47"
          textAnchor="middle"
          className="fill-foreground text-[9px] font-semibold"
        >
          合计
        </text>
        <text
          x="50"
          y="59"
          textAnchor="middle"
          className="fill-muted-foreground text-[7px]"
        >
          {formatMoney(total)}
        </text>
      </svg>
      <div className="space-y-2">
        {data.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="truncate">{item.label}</span>
            </div>
            <span className="tabular shrink-0 text-muted-foreground">
              {formatPercent(total > 0 ? item.value / total : 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdjustmentTable({
  rows,
  totalCost,
  totalValue,
}: {
  rows: RebalanceRow[];
  totalCost: number;
  totalValue: number;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>调整建议明细</CardTitle>
        <CardDescription>调整数量按当前价格估算，实际交易需考虑最小单位与费用。</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table className="min-w-[840px]">
          <TableHeader>
            <TableRow>
              <TableHead>产品</TableHead>
              <TableHead className="text-right">总成本</TableHead>
              <TableHead className="text-right">成本比例</TableHead>
              <TableHead className="text-right">当前市值</TableHead>
              <TableHead className="text-right">当前比例</TableHead>
              <TableHead className="text-right">目标市值</TableHead>
              <TableHead className="text-right">调整金额</TableHead>
              <TableHead className="text-right">调整数量</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isBuy = row.delta > 0.01;
              const isSell = row.delta < -0.01;
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      {row.name}
                    </div>
                  </TableCell>
                  <TableCell className="tabular text-right">{formatMoney(row.totalCost)}</TableCell>
                  <TableCell className="tabular text-right">{formatPercent(row.costRatio)}</TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {formatMoney(row.currentValue)}
                  </TableCell>
                  <TableCell className="tabular text-right">{formatPercent(row.valueRatio)}</TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {formatMoney(row.targetValue)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "tabular text-right font-semibold",
                      row.delta >= 0
                        ? "text-emerald-600 dark:text-emerald-300"
                        : "text-red-600 dark:text-red-300",
                    )}
                  >
                    {signed(row.delta)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "tabular text-right",
                      row.deltaQty >= 0
                        ? "text-emerald-600 dark:text-emerald-300"
                        : "text-red-600 dark:text-red-300",
                    )}
                  >
                    {signed(Math.round(row.deltaQty), (value) =>
                      value.toLocaleString("zh-CN", { maximumFractionDigits: 0 }),
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {isBuy || isSell ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          isBuy
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
                        )}
                      >
                        {isBuy ? (
                          <ArrowUp className="mr-1 h-3 w-3" />
                        ) : (
                          <ArrowDown className="mr-1 h-3 w-3" />
                        )}
                        {isBuy ? "买入" : "卖出"}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">无需调整</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>合计</TableCell>
              <TableCell className="tabular text-right">{formatMoney(totalCost)}</TableCell>
              <TableCell className="tabular text-right">100.00%</TableCell>
              <TableCell className="tabular text-right">{formatMoney(totalValue)}</TableCell>
              <TableCell className="tabular text-right">100.00%</TableCell>
              <TableCell className="tabular text-right">{formatMoney(totalValue)}</TableCell>
              <TableCell className="tabular text-right">0.00</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-center">-</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

function ValueBarChart({ rows }: { rows: RebalanceRow[] }) {
  const max = Math.max(
    ...rows.flatMap((row) => [row.currentValue, row.targetValue]),
    1,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>当前市值 vs 目标市值</CardTitle>
        <CardDescription>横向长度用于比较调整前后的市值差异。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {rows.map((row) => (
          <div key={row.id} className="grid gap-2 md:grid-cols-[150px_1fr] md:items-center">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
              />
              <span className="truncate">{row.name}</span>
            </div>
            <div className="space-y-2">
              <BarLine
                label="当前"
                value={row.currentValue}
                max={max}
                className="bg-primary/25"
                textClassName="text-primary"
              />
              <BarLine
                label="目标"
                value={row.targetValue}
                max={max}
                className="bg-accent/80"
                textClassName="text-accent"
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function BarLine({
  label,
  value,
  max,
  className,
  textClassName,
}: {
  label: string;
  value: number;
  max: number;
  className: string;
  textClassName: string;
}) {
  return (
    <div className="grid grid-cols-[38px_1fr_92px] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="h-3 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", className)}
          style={{ width: `${Math.max((value / max) * 100, 1)}%` }}
        />
      </div>
      <span className={cn("tabular text-right font-medium", textClassName)}>
        {formatMoney(value)}
      </span>
    </div>
  );
}

function ToastLayer({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="fixed right-4 top-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "rounded-lg border bg-card px-4 py-3 text-sm shadow-lg",
            toast.type === "success" &&
              "border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300",
            toast.type === "error" &&
              "border-red-200 text-red-700 dark:border-red-900 dark:text-red-300",
            toast.type === "info" &&
              "border-cyan-200 text-cyan-700 dark:border-cyan-900 dark:text-cyan-300",
          )}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

export default App;
