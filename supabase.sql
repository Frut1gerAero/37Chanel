-- run this in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    board TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "isOp" BOOLEAN DEFAULT FALSE,
    subject TEXT,
    comment TEXT,
    name TEXT,
    sage BOOLEAN DEFAULT FALSE,
    timestamp BIGINT NOT NULL,
    images TEXT[] DEFAULT '{}',
    locked BOOLEAN DEFAULT FALSE,
    sticky BOOLEAN DEFAULT FALSE,
    replies TEXT[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board);
CREATE INDEX IF NOT EXISTS idx_posts_threadid ON posts("threadId");
CREATE INDEX IF NOT EXISTS idx_posts_timestamp ON posts(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_posts_isop ON posts("isOp");

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON posts
    FOR SELECT USING (true);

CREATE POLICY "Enable insert for all users" ON posts
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for all users" ON posts
    FOR UPDATE USING (true);

CREATE POLICY "Enable delete for all users" ON posts
    FOR DELETE USING (true);

INSERT INTO storage.buckets (id, name, public) 
VALUES ('images', 'images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Give public access to images" ON storage.objects
    FOR SELECT USING (bucket_id = 'images');

CREATE POLICY "Allow public uploads to images" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'images');

CREATE POLICY "Allow public updates to images" ON storage.objects
    FOR UPDATE USING (bucket_id = 'images');

CREATE POLICY "Allow public deletes to images" ON storage.objects
    FOR DELETE USING (bucket_id = 'images');
