import { useEffect, useState } from 'react';
import { supabase } from './api';

export type LiveContent = {
  id: string;
  content_type: 'poster' | 'announcement' | 'banner';
  title: string;
  body: string;
  image_url: string | null;
  action_url: string | null;
  status: 'published';
  published_at: string;
  updated_at: string;
};

const COLUMNS = 'id, content_type, title, body, image_url, action_url, status, published_at, updated_at';

async function loadPublished() {
  const { data, error } = await supabase
    .from('app_content')
    .select(COLUMNS)
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as LiveContent[];
}

export function useLiveContent() {
  const [content, setContent] = useState<LiveContent[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const refresh = () => { void loadPublished().then((rows) => { if (active) setContent(rows); }).catch(() => undefined).finally(() => { if (active) setLoading(false); }); };
    refresh();
    const channel = supabase
      .channel('live-app-content')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_content' }, refresh)
      .subscribe();
    const fallback = setInterval(refresh, 30_000);
    return () => { active = false; clearInterval(fallback); void supabase.removeChannel(channel); };
  }, []);
  return { content, loading };
}
