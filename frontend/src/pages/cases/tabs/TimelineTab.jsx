import { useQuery } from '@tanstack/react-query';
import { casesApi } from '@/services/casesApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { ErrorState } from '@/components/data/States';
import { ActivityTimeline } from '@/components/workflow/ActivityTimeline';

export default function TimelineTab({ c, isClient }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['timeline', c.id, c.rowVersion], queryFn: () => casesApi.timeline(c.id) });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity timeline</CardTitle>
        <CardDescription>{isClient ? 'Key milestones of your case.' : 'Every action on this case, in order. Entries cannot be edited or deleted.'}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-40" />}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {data && <ActivityTimeline items={data.items} showIp={!isClient} />}
      </CardContent>
    </Card>
  );
}
