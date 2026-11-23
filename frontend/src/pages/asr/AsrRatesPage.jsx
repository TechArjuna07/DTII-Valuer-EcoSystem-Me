import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { asrApi } from '@/services/asrApi';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton, Spinner } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { EmptyState, ErrorState } from '@/components/data/States';
import { formatDateTime, formatINR } from '@/utils/format';

const UNIT = { SQ_M: 'per sq. m', HECTARE: 'per hectare', SQ_FT: 'per sq. ft', ARE: 'per are' };
const AREA_LABEL = { URBAN: 'Urban zones', INFLUENCE: 'Influence area', RURAL: 'Rural', NONE: 'No rates published' };
const unitLabel = (r) => UNIT[r.unitCode] ?? r.unit ?? '';
const money = (v) => (v == null ? '—' : v === 0 ? '0' : formatINR(v));

/** Survey number match: "140" matches "140" and "140/2"; case-insensitive for "19B" style numbers. */
const matchesSurvey = (list, term) => {
  const t = term.trim().toLowerCase();
  return !!t && list.some((s) => {
    const v = s.toLowerCase();
    return v === t || v.split('/')[0] === t;
  });
};

function SurveyNumbers({ row, highlight }) {
  const [open, setOpen] = useState(false);
  if (!row.surveyNumbersFetched) return <span className="text-xs text-muted-foreground">loading…</span>;
  const list = row.surveyNumbers;
  if (!list.length) return <span className="text-xs text-muted-foreground">—</span>;
  const shown = open ? list : list.slice(0, 10);
  return (
    <div className="max-w-md text-xs leading-relaxed">
      {shown.map((s, i) => (
        <span key={`${s}-${i}`} className={matchesSurvey([s], highlight) ? 'rounded bg-primary/15 px-1 font-semibold text-primary' : undefined}>
          {s}
          {i < shown.length - 1 ? ', ' : ''}
        </span>
      ))}
      {list.length > 10 && (
        <button type="button" className="ml-1 text-primary underline-offset-2 hover:underline" onClick={() => setOpen(!open)}>
          {open ? 'show less' : `+${list.length - 10} more`}
        </button>
      )}
    </div>
  );
}

function RatesTable({ head, rows, render }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{rows.map(render)}</tbody>
      </table>
    </div>
  );
}

function RateGrid({ data, survey }) {
  const rows = survey.trim() ? data.rates.filter((r) => matchesSurvey(r.surveyNumbers, survey)) : data.rates;
  const td = 'px-3 py-2 align-top';
  const num = `${td} whitespace-nowrap text-right tabular-nums`;
  if (data.areaType === 'NONE' || !data.rates.length) return <EmptyState title="No rates published" description="eASR publishes no rates for this village for the selected year." />;
  if (survey.trim() && !rows.length) return <EmptyState title={`Survey no. ${survey.trim()} not found`} description={data.surveyNumbersStatus === 'READY' ? 'It is not listed in any zone of this village.' : 'Survey numbers are still being fetched; try again shortly.'} />;

  if (data.areaType === 'URBAN') {
    return (
      <RatesTable
        head={['Zone', 'Open land', 'Residential', 'Office', 'Shop', 'Industrial', 'Unit', 'Survey nos.']}
        rows={rows}
        render={(r) => (
          <tr key={r.seq}>
            <td className={td}>
              <span className="font-mono text-xs text-muted-foreground">{r.zoneCode}</span> <span>{r.zoneName}</span>
            </td>
            <td className={num}>{money(r.openLand)}</td>
            <td className={num}>{money(r.residential)}</td>
            <td className={num}>{money(r.office)}</td>
            <td className={num}>{money(r.shop)}</td>
            <td className={num}>{money(r.industrial)}</td>
            <td className={`${td} whitespace-nowrap text-xs`}>{unitLabel(r)}</td>
            <td className={td}>
              <SurveyNumbers row={r} highlight={survey} />
            </td>
          </tr>
        )}
      />
    );
  }

  if (data.areaType === 'INFLUENCE') {
    const groups = [...new Set(rows.map((r) => r.locationName))];
    return (
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g} className="space-y-2">
            <h3 className="text-sm font-semibold">{g}</h3>
            <RatesTable
              head={['Vibhag', 'Sub-zone', 'Rate', 'Unit', 'Survey nos.']}
              rows={rows.filter((r) => r.locationName === g)}
              render={(r) => (
                <tr key={r.seq}>
                  <td className={`${td} whitespace-nowrap font-mono text-xs`}>{r.zoneCode}</td>
                  <td className={td}>{r.zoneName}</td>
                  <td className={num}>{money(r.rate)}</td>
                  <td className={`${td} whitespace-nowrap text-xs`}>{unitLabel(r)}</td>
                  <td className={td}>
                    <SurveyNumbers row={r} highlight={survey} />
                  </td>
                </tr>
              )}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <RatesTable
      head={['Assessment type', 'Area range', 'Rate', 'Unit']}
      rows={rows}
      render={(r) => (
        <tr key={r.seq}>
          <td className={td}>{r.assessmentType}</td>
          <td className={`${td} whitespace-nowrap`}>{r.assessmentRange}</td>
          <td className={num}>{money(r.rate)}</td>
          <td className={`${td} whitespace-nowrap text-xs`}>{unitLabel(r)}</td>
        </tr>
      )}
    />
  );
}

function StatusCard() {
  const { data } = useQuery({ queryKey: ['asr', 'status'], queryFn: asrApi.status, refetchInterval: 30_000 });
  if (!data) return null;
  const sets = data.counts.rateSets;
  return (
    <Card>
      <CardHeader>
        <CardTitle>eASR cache (platform)</CardTitle>
        <CardDescription>
          {data.enabled ? 'Lookups enabled' : 'Lookups switched off'} · at most one request every {data.minIntervalMs} ms · current-year statements refreshed after {data.refreshDays} days
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-muted-foreground">Talukas / villages cached</p>
          <p className="text-lg font-semibold">
            {data.counts.talukas} / {data.counts.villages}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Village statements</p>
          <p className="text-lg font-semibold">
            {sets.READY ?? 0} ready{sets.FAILED ? ` · ${sets.FAILED} failed` : ''}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Government-site requests (24 h)</p>
          <p className="text-lg font-semibold">{data.last24h.requests}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Last fetch</p>
          <p className="text-sm">{data.recent[0] ? `${data.recent[0].ok ? 'OK' : 'Failed'} · ${formatDateTime(data.recent[0].at)}` : '—'}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Government ready-reckoner (Annual Statement of Rates) lookup: district → taluka → village → zone rates. */
export default function AsrRatesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [sel, setSel] = useState({ year: '', district: '', taluka: '', village: '' });
  const [survey, setSurvey] = useState('');

  const districts = useQuery({ queryKey: ['asr', 'districts'], queryFn: asrApi.districts, staleTime: 3_600_000 });
  const years = useQuery({ queryKey: ['asr', 'years', !!sel.district], queryFn: asrApi.years, staleTime: 3_600_000 });
  const talukas = useQuery({ queryKey: ['asr', 'talukas', sel.district], queryFn: () => asrApi.talukas(sel.district), enabled: !!sel.district, staleTime: 3_600_000, retry: false });
  const villages = useQuery({ queryKey: ['asr', 'villages', sel.taluka], queryFn: () => asrApi.villages(sel.taluka), enabled: !!sel.taluka, staleTime: 3_600_000, retry: false });
  const year = sel.year || years.data?.current || undefined;
  const rates = useQuery({
    queryKey: ['asr', 'rates', sel.village, year],
    queryFn: () => asrApi.rates(sel.village, year),
    enabled: !!sel.village,
    retry: false,
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && (['PENDING', 'FETCHING'].includes(d.status) || d.surveyNumbersStatus === 'FETCHING') ? 3000 : false;
    },
  });
  const refresh = useMutation({
    mutationFn: () => asrApi.refresh(sel.village, year),
    onSuccess: () => {
      toast.success('Refresh queued. The cached rates stay visible until the new copy is stored.');
      qc.invalidateQueries({ queryKey: ['asr'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const set = (k) => (e) => {
    const v = e.target.value;
    setSurvey('');
    setSel((s) => ({ ...s, [k]: v, ...(k === 'district' ? { taluka: '', village: '' } : k === 'taluka' ? { village: '' } : {}) }));
  };
  const d = rates.data;
  const loadingList = (q, what) => q.isFetching && !q.data && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Spinner className="size-3" /> Loading {what} from IGR eASR…</p>;
  const surveyHits = useMemo(() => (d && survey.trim() ? d.rates.filter((r) => matchesSurvey(r.surveyNumbers, survey)).length : null), [d, survey]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="ASR rates (IGR Maharashtra)"
        description="Government ready-reckoner rates from the eASR Annual Statement of Rates. Each village is fetched from IGR once and then shared by every firm on the platform."
      />

      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="asr-year">Statement year</Label>
            <NativeSelect id="asr-year" value={sel.year} onChange={set('year')}>
              <option value="">{years.data?.items[0] ? `${years.data.items[0].label} (latest)` : 'Latest'}</option>
              {years.data?.items.slice(1).map((y) => (
                <option key={y.code} value={y.code}>
                  {y.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asr-district">District</Label>
            <NativeSelect id="asr-district" value={sel.district} onChange={set('district')}>
              <option value="">Select district</option>
              {districts.data?.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asr-taluka">Taluka</Label>
            <NativeSelect id="asr-taluka" value={sel.taluka} onChange={set('taluka')} disabled={!talukas.data}>
              <option value="">Select taluka</option>
              {talukas.data?.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
            {loadingList(talukas, 'talukas')}
            {talukas.error && <p className="mt-1 text-xs text-destructive">{talukas.error.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asr-village">Village</Label>
            <NativeSelect id="asr-village" value={sel.village} onChange={set('village')} disabled={!villages.data}>
              <option value="">Select village</option>
              {villages.data?.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
            {loadingList(villages, 'villages')}
            {villages.error && <p className="mt-1 text-xs text-destructive">{villages.error.message}</p>}
          </div>
        </CardContent>
      </Card>

      {sel.village && rates.isLoading && <Skeleton className="h-64" />}
      {rates.error && <ErrorState error={rates.error} onRetry={rates.refetch} />}

      {d && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex flex-wrap items-center gap-2">
                {d.village.name}
                {d.areaType && <Badge tone="primary">{AREA_LABEL[d.areaType]}</Badge>}
                {d.vibhagNo && <Badge>Vibhag {d.vibhagNo}</Badge>}
                {d.stale && <Badge tone="warning">refresh queued</Badge>}
              </CardTitle>
              <CardDescription>
                {d.taluka.name}, {d.district.name} · Statement {d.year.label}
                {d.fetchedAt ? ` · fetched ${formatDateTime(d.fetchedAt)}` : ''}
              </CardDescription>
            </div>
            {can('asr.manage') && (
              <Button variant="outline" size="sm" loading={refresh.isPending} onClick={() => refresh.mutate()}>
                <RefreshCw /> Refresh from IGR
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {['PENDING', 'FETCHING'].includes(d.status) && (
              <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                <Spinner className="mt-0.5 size-4" />
                <div>
                  <p className="font-medium">Fetching this village from IGR eASR for the first time…</p>
                  <p className="text-muted-foreground">Usually under a minute (the government site is queried slowly and politely). This page updates by itself; after this, every firm gets it instantly.</p>
                </div>
              </div>
            )}
            {d.status === 'FAILED' && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                <p className="font-medium text-destructive">The IGR eASR site could not be read just now.</p>
                <p className="text-muted-foreground">{d.lastError}. It is retried automatically in a few minutes; open this village again later.</p>
              </div>
            )}

            {d.status === 'READY' && (
              <>
                {d.areaType !== 'RURAL' && d.areaType !== 'NONE' && (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-60 space-y-1.5">
                      <Label htmlFor="asr-survey">Find survey / CTS no.</Label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input id="asr-survey" className="pl-8" placeholder="e.g. 140" value={survey} onChange={(e) => setSurvey(e.target.value)} />
                      </div>
                    </div>
                    {surveyHits != null && <p className="pb-2 text-sm text-muted-foreground">{surveyHits ? `Found in ${surveyHits} zone${surveyHits > 1 ? 's' : ''}` : 'Not found'}</p>}
                    {d.surveyNumbersStatus === 'FETCHING' && (
                      <p className="flex items-center gap-1 pb-2 text-xs text-muted-foreground">
                        <Spinner className="size-3" /> Survey numbers are still being fetched…
                      </p>
                    )}
                  </div>
                )}
                <RateGrid data={d} survey={survey} />
              </>
            )}

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Source:{' '}
                <a href={d.source.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {d.source.name}
                </a>
                . eASR 2.0 is a beta site; IGR advises verifying rates with eASR 1.9 or the Sub-Registrar before relying on them in a report.
              </span>
            </p>
          </CardContent>
        </Card>
      )}

      {can('asr.manage') && <StatusCard />}
    </div>
  );
}
