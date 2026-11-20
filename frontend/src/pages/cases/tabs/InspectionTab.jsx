import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, Circle, Crosshair, ExternalLink, MapPin, Play, Plus, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { inspectionsApi } from '@/services/inspectionsApi';
import { documentsApi } from '@/services/documentsApi';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlays';
import { EmptyState, ErrorState } from '@/components/data/States';
import { cn } from '@/utils/cn';
import { formatDateTime, humanize } from '@/utils/format';

const CONDITIONS = ['EXCELLENT', 'GOOD', 'AVERAGE', 'POOR', 'DILAPIDATED'];
const PHOTO_KINDS = [
  ['PROPERTY', 'Property'],
  ['LOCATION', 'Location / approach'],
  ['LANDMARK', 'Landmark'],
  ['OTHER', 'Other'],
];

const toForm = (i) => ({
  propertyType: i?.propertyType ?? '',
  propertyAddress: i?.propertyAddress ?? '',
  landArea: i?.landArea ?? '',
  landAreaUnit: i?.landAreaUnit ?? 'sq.ft',
  buildingArea: i?.buildingArea ?? '',
  buildingAreaUnit: i?.buildingAreaUnit ?? 'sq.ft',
  condition: i?.condition ?? '',
  inspectedAt: i?.inspectedAt ? i.inspectedAt.slice(0, 16) : '',
  construction: { structure: '', yearOfConstruction: '', floors: '', roofing: '', flooring: '', walls: '', estimatedLifeYears: '', maintenance: '', ...(i?.construction ?? {}) },
  boundaries: { north: '', south: '', east: '', west: '', ...(i?.boundaries ?? {}) },
  observations: { occupancy: '', accessRoad: '', amenities: '', deviations: '', neighbourhood: '', ...(i?.observations ?? {}) },
  landmarks: i?.landmarks ?? [],
  officerRemarks: i?.officerRemarks ?? '',
});

/** '' → undefined recursively, so optional fields are omitted. */
const clean = (o) =>
  Object.fromEntries(
    Object.entries(o)
      .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? clean(v) : v])
      .filter(([, v]) => v !== '' && v !== undefined),
  );

function PhotoThumb({ photo, onRemove, canEdit }) {
  const { data } = useQuery({ queryKey: ['photo-link', photo.documentId], queryFn: () => documentsApi.link(photo.documentId, { disposition: 'inline' }), staleTime: 45_000, enabled: photo.downloadable });
  return (
    <figure className="group relative overflow-hidden rounded-lg border bg-muted">
      {data?.url ? <img src={data.url} alt={photo.caption ?? photo.kind} className="aspect-square w-full object-cover" loading="lazy" /> : <div className="aspect-square w-full animate-pulse" />}
      <figcaption className="p-2 text-xs">
        <Badge>{humanize(photo.kind)}</Badge>
        <span className="mt-1 block truncate">{photo.caption}</span>
        {photo.gpsLat != null && <span className="block text-[10px] text-muted-foreground">📍 {Number(photo.gpsLat).toFixed(5)}, {Number(photo.gpsLng).toFixed(5)}</span>}
      </figcaption>
      {canEdit && (
        <button onClick={() => onRemove(photo)} className="absolute right-1 top-1 rounded-md bg-card/90 p-1.5 text-destructive opacity-90 shadow" aria-label="Remove photo from inspection">
          <Trash2 className="size-4" />
        </button>
      )}
    </figure>
  );
}

/** Camera capture button for one photo kind; the device location (if consented) is attached to the photo. */
function CaptureButton({ kind, label, onFile }) {
  const ref = useRef(null);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => ref.current?.click()}>
        <Camera /> {label}
      </Button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) onFile(kind, e.target.files[0]);
          e.target.value = '';
        }}
      />
    </>
  );
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('This device does not provide location'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'Location permission was denied' : 'Could not determine the location (location needs HTTPS on phones)')),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}

export default function InspectionTab({ c }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['inspection', c.id], queryFn: () => inspectionsApi.get(c.id) });
  const [form, setForm] = useState(toForm(null));
  const [scheduleAt, setScheduleAt] = useState('');
  const [consentAsked, setConsentAsked] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [uploading, setUploading] = useState(0);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  useEffect(() => data && setForm(toForm(data.current)), [data]);

  const refresh = (res) => {
    qc.setQueryData(['inspection', c.id], res);
    qc.invalidateQueries({ queryKey: ['cases', 'detail', c.id] });
    qc.invalidateQueries({ queryKey: ['documents', c.id] });
  };
  const onErr = (e) => toast.error(e.details?.join(' · ') ?? e.message);
  const call = useMutation({ mutationFn: (fn) => fn(), onSuccess: refresh, onError: onErr });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-96" />;
  const i = data.current;
  const edit = data.canEdit && c.status === 'INSPECTION_IN_PROGRESS';
  const set = (path, v) => {
    const [a, b] = path.split('.');
    setForm((f) => (b ? { ...f, [a]: { ...f[a], [b]: v } } : { ...f, [a]: v }));
  };
  const saveDraft = () =>
    call.mutate(() => inspectionsApi.saveDraft(c.id, clean({ ...form, landmarks: form.landmarks.filter((l) => l.name), inspectedAt: form.inspectedAt ? new Date(form.inspectedAt).toISOString() : '' })), {
      onSuccess: () => toast.success('Draft saved'),
    });
  const captureGps = async () => {
    try {
      const p = await getPosition();
      call.mutate(() => inspectionsApi.saveDraft(c.id, { gpsConsent: true, gpsLat: p.lat, gpsLng: p.lng, gpsAccuracyM: Math.round(p.accuracy) }), { onSuccess: () => toast.success('Location captured') });
    } catch (e) {
      toast.error(e.message);
    }
  };
  const addPhoto = async (kind, file) => {
    setUploading((n) => n + 1);
    try {
      let gps = {};
      if (i?.gpsConsent) gps = await getPosition().then((p) => ({ gpsLat: p.lat, gpsLng: p.lng })).catch(() => ({}));
      refresh(await inspectionsApi.addPhoto(c.id, { file, kind, caption: `${humanize(kind)} – ${new Date().toLocaleTimeString('en-IN')}`, capturedAt: new Date().toISOString(), ...gps }));
      toast.success('Photo added');
    } catch (e) {
      onErr(e);
    } finally {
      setUploading((n) => n - 1);
    }
  };

  // Not started yet: schedule / start controls (assigned field officer) or a waiting message.
  if (!i || c.status === 'INSPECTION_ASSIGNED') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Property inspection</CardTitle>
          <CardDescription>{data.isAssignedOfficer ? 'Schedule the visit with the client, then start the inspection on site.' : 'The assigned field officer has not started the inspection yet.'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {i?.scheduledAt && <p className="text-sm">Scheduled for {formatDateTime(i.scheduledAt)}</p>}
          {data.canStart || (data.isAssignedOfficer && c.status === 'INSPECTION_IN_PROGRESS') ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="schedule-at">Visit date & time</Label>
                <Input id="schedule-at" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
              </div>
              <Button variant="outline" disabled={!scheduleAt} loading={call.isPending} onClick={() => call.mutate(() => inspectionsApi.schedule(c.id, new Date(scheduleAt).toISOString()), { onSuccess: () => toast.success('Visit scheduled') })}>
                Schedule visit
              </Button>
              <Button loading={call.isPending} onClick={() => call.mutate(() => inspectionsApi.start(c.id))}>
                <Play /> Start inspection now
              </Button>
            </div>
          ) : (
            <EmptyState title="Inspection not started" />
          )}
        </CardContent>
      </Card>
    );
  }

  const field = (path, label, props = {}) => {
    const [a, b] = path.split('.');
    const value = b ? form[a][b] : form[a];
    return (
      <div className={cn('space-y-1.5', props.className)}>
        <Label htmlFor={`in-${path}`}>{label}</Label>
        {props.textarea ? (
          <Textarea id={`in-${path}`} value={value ?? ''} disabled={!edit} onChange={(e) => set(path, e.target.value)} />
        ) : (
          <Input id={`in-${path}`} value={value ?? ''} disabled={!edit} onChange={(e) => set(path, e.target.value)} {...props.input} />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>
              Inspection round {i.round} <Badge tone={i.status === 'SUBMITTED' ? 'success' : 'warning'}>{i.status === 'SUBMITTED' ? 'submitted' : 'draft'}</Badge>
            </CardTitle>
            <CardDescription>
              Officer {i.officerName}
              {i.scheduledAt ? ` · scheduled ${formatDateTime(i.scheduledAt)}` : ''}
              {i.startedAt ? ` · started ${formatDateTime(i.startedAt)}` : ''}
              {i.submittedAt ? ` · submitted ${formatDateTime(i.submittedAt)}` : ''}
            </CardDescription>
          </div>
          {edit && (
            <Button variant="outline" loading={call.isPending} onClick={saveDraft}>
              Save draft
            </Button>
          )}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="size-4" /> Location (GPS)
          </CardTitle>
          <CardDescription>The property&apos;s coordinates are recorded only with consent, and are stored as evidence of the site visit.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {i.gpsLat != null ? (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-success" /> {Number(i.gpsLat).toFixed(6)}, {Number(i.gpsLng).toFixed(6)} {i.gpsAccuracyM != null && <span className="text-muted-foreground">± {Number(i.gpsAccuracyM)} m</span>}
              <span className="text-muted-foreground">· {formatDateTime(i.gpsCapturedAt)}</span>
              <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`https://www.openstreetmap.org/?mlat=${i.gpsLat}&mlon=${i.gpsLng}#map=18/${i.gpsLat}/${i.gpsLng}`} target="_blank" rel="noopener noreferrer">
                Map <ExternalLink className="size-3" />
              </a>
            </p>
          ) : i.gpsConsent === false ? (
            <p className="text-sm text-warning">Location not captured: {i.gpsDeclinedReason}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Not captured yet.</p>
          )}
          {edit &&
            (consentAsked ? (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm">The device location will be recorded with this inspection and visible to your firm and the lender&apos;s report. Continue?</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => (setConsentAsked(false), captureGps())}>
                    <Crosshair /> I consent, capture location
                  </Button>
                  <Input className="sm:w-72" placeholder="Reason if declined" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} aria-label="Reason for declining" />
                  <Button
                    variant="outline"
                    disabled={declineReason.trim().length < 3}
                    onClick={() => call.mutate(() => inspectionsApi.saveDraft(c.id, { gpsConsent: false, gpsDeclinedReason: declineReason.trim() }), { onSuccess: () => setConsentAsked(false) })}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setConsentAsked(true)}>
                <Crosshair /> {i.gpsLat != null ? 'Recapture location' : 'Capture location'}
              </Button>
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Property & construction</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {field('propertyType', 'Property type', { className: 'sm:col-span-2' })}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="in-condition">Condition</Label>
            <NativeSelect id="in-condition" value={form.condition} disabled={!edit} onChange={(e) => set('condition', e.target.value)}>
              <option value="">Select…</option>
              {CONDITIONS.map((x) => (
                <option key={x} value={x}>
                  {humanize(x)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {field('propertyAddress', 'Property address (as inspected)', { className: 'sm:col-span-2 lg:col-span-4', textarea: true })}
          {field('landArea', 'Land area', { input: { type: 'number', inputMode: 'decimal', min: 0 } })}
          <div className="space-y-1.5">
            <Label htmlFor="in-landAreaUnit">Unit</Label>
            <NativeSelect id="in-landAreaUnit" value={form.landAreaUnit} disabled={!edit} onChange={(e) => set('landAreaUnit', e.target.value)}>
              {['sq.ft', 'sq.m', 'acre', 'hectare', 'guntha'].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </NativeSelect>
          </div>
          {field('buildingArea', 'Building (built-up) area', { input: { type: 'number', inputMode: 'decimal', min: 0 } })}
          <div className="space-y-1.5">
            <Label htmlFor="in-buildingAreaUnit">Unit</Label>
            <NativeSelect id="in-buildingAreaUnit" value={form.buildingAreaUnit} disabled={!edit} onChange={(e) => set('buildingAreaUnit', e.target.value)}>
              {['sq.ft', 'sq.m'].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </NativeSelect>
          </div>
          {field('inspectedAt', 'Inspection date & time', { input: { type: 'datetime-local' } })}
          {field('construction.structure', 'Structure')}
          {field('construction.yearOfConstruction', 'Year of construction', { input: { type: 'number', inputMode: 'numeric' } })}
          {field('construction.floors', 'Floors', { input: { type: 'number', inputMode: 'numeric' } })}
          {field('construction.roofing', 'Roofing')}
          {field('construction.flooring', 'Flooring')}
          {field('construction.walls', 'Walls')}
          {field('construction.estimatedLifeYears', 'Estimated total life (years)', { input: { type: 'number', inputMode: 'numeric' } })}
          {field('construction.maintenance', 'Maintenance')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Boundaries, landmarks & observations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {field('boundaries.north', 'North')}
            {field('boundaries.south', 'South')}
            {field('boundaries.east', 'East')}
            {field('boundaries.west', 'West')}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Landmarks</p>
            {form.landmarks.map((l, idx) => (
              <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_120px_120px_auto]">
                <Input aria-label="Landmark" value={l.name} disabled={!edit} onChange={(e) => setForm((f) => ({ ...f, landmarks: f.landmarks.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x)) }))} placeholder="e.g. Bus depot" />
                <Input aria-label="Distance" value={l.distance ?? ''} disabled={!edit} onChange={(e) => setForm((f) => ({ ...f, landmarks: f.landmarks.map((x, j) => (j === idx ? { ...x, distance: e.target.value } : x)) }))} placeholder="500 m" />
                <Input aria-label="Direction" value={l.direction ?? ''} disabled={!edit} onChange={(e) => setForm((f) => ({ ...f, landmarks: f.landmarks.map((x, j) => (j === idx ? { ...x, direction: e.target.value } : x)) }))} placeholder="North" />
                {edit && (
                  <Button size="icon" variant="ghost" aria-label="Remove landmark" onClick={() => setForm((f) => ({ ...f, landmarks: f.landmarks.filter((_, j) => j !== idx) }))}>
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
            {edit && (
              <Button size="sm" variant="outline" onClick={() => setForm((f) => ({ ...f, landmarks: [...f.landmarks, { name: '', distance: '', direction: '' }] }))}>
                <Plus /> Add landmark
              </Button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field('observations.occupancy', 'Occupancy')}
            {field('observations.accessRoad', 'Access road')}
            {field('observations.amenities', 'Amenities', { textarea: true })}
            {field('observations.neighbourhood', 'Neighbourhood', { textarea: true })}
            {field('observations.deviations', 'Deviations from approved plan', { textarea: true, className: 'sm:col-span-2' })}
            {field('officerRemarks', 'Officer remarks', { textarea: true, className: 'sm:col-span-2' })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Photographs ({i.photos.length})</CardTitle>
          {edit && (
            <div className="flex flex-wrap gap-2">
              {PHOTO_KINDS.map(([k, l]) => (
                <CaptureButton key={k} kind={k} label={l} onFile={addPhoto} />
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {uploading > 0 && <p className="mb-3 text-sm text-muted-foreground">Uploading {uploading} photo(s)…</p>}
          {i.photos.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {i.photos.map((p) => (
                <PhotoThumb key={p.id} photo={p} canEdit={edit} onRemove={(ph) => call.mutate(() => inspectionsApi.removePhoto(c.id, ph.id))} />
              ))}
            </div>
          ) : (
            <EmptyState title="No photographs yet" description={edit ? 'Use the camera buttons above. Photos are stored in 03_Property_Photographs.' : undefined} />
          )}
        </CardContent>
      </Card>

      {i.status === 'DRAFT' && (
        <Card>
          <CardHeader>
            <CardTitle>Ready to submit?</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {data.readiness.checks.map((ch) => (
                <li key={ch.key} className="flex items-start gap-2 text-sm">
                  {ch.ok ? <CheckCircle2 className="mt-0.5 size-4 text-success" /> : <Circle className="mt-0.5 size-4 text-muted-foreground" />}
                  <span>
                    {ch.label}
                    {ch.detail && <span className="text-muted-foreground"> · {ch.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Save the draft to refresh this checklist.</p>
          </CardContent>
        </Card>
      )}

      {data.previousRounds.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Earlier rounds: {data.previousRounds.map((r) => `#${r.round} by ${r.officerName} (${formatDateTime(r.submittedAt)}, ${r.photoCount} photos)`).join(' · ')}
        </p>
      )}

      {data.canSubmit && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t bg-card/95 p-3 backdrop-blur lg:static lg:justify-end lg:border-0 lg:bg-transparent lg:p-0">
          <Button variant="outline" className="flex-1 lg:flex-none" loading={call.isPending} onClick={saveDraft}>
            Save draft
          </Button>
          <Button className="flex-1 lg:flex-none" disabled={!data.readiness.ready} onClick={() => setConfirmSubmit(true)}>
            <Send /> Submit inspection
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
        title="Submit the inspection report?"
        description="Findings and photographs are locked and the case moves to the junior technical reviewer."
        confirmLabel="Submit"
        loading={call.isPending}
        onConfirm={() => call.mutate(() => inspectionsApi.submit(c.id), { onSuccess: () => (setConfirmSubmit(false), toast.success('Inspection submitted')) })}
      />
    </div>
  );
}
