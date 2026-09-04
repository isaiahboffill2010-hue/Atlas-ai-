-- Create knowledge_files table
CREATE TABLE IF NOT EXISTS knowledge_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Business', 'Printing', 'Personal')),
  type TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  file_size INTEGER NOT NULL,
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed')),
  extracted_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create knowledge_chunks table for searchable content
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES knowledge_files(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  page_number INTEGER,
  chunk_index INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_knowledge_files_category ON knowledge_files(category);
CREATE INDEX idx_knowledge_files_processing_status ON knowledge_files(processing_status);
CREATE INDEX idx_knowledge_files_created_at ON knowledge_files(created_at DESC);
CREATE INDEX idx_knowledge_chunks_file_id ON knowledge_chunks(file_id);
CREATE INDEX idx_knowledge_chunks_content ON knowledge_chunks USING GIN (to_tsvector('english', content));

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_knowledge_files_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
CREATE TRIGGER trigger_knowledge_files_updated_at
BEFORE UPDATE ON knowledge_files
FOR EACH ROW
EXECUTE FUNCTION update_knowledge_files_updated_at();

-- Create RLS (Row Level Security) policies
ALTER TABLE knowledge_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read knowledge files
CREATE POLICY "Allow authenticated users to read knowledge files"
  ON knowledge_files
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert knowledge files
CREATE POLICY "Allow authenticated users to insert knowledge files"
  ON knowledge_files
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update knowledge files
CREATE POLICY "Allow authenticated users to update knowledge files"
  ON knowledge_files
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to delete knowledge files
CREATE POLICY "Allow authenticated users to delete knowledge files"
  ON knowledge_files
  FOR DELETE
  TO authenticated
  USING (true);

-- Allow all authenticated users to read knowledge chunks
CREATE POLICY "Allow authenticated users to read knowledge chunks"
  ON knowledge_chunks
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert knowledge chunks
CREATE POLICY "Allow authenticated users to insert knowledge chunks"
  ON knowledge_chunks
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to delete knowledge chunks
CREATE POLICY "Allow authenticated users to delete knowledge chunks"
  ON knowledge_chunks
  FOR DELETE
  TO authenticated
  USING (true);

-- Create the storage bucket (note: this may need to be done via dashboard for now)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('atlas-library', 'atlas-library', false);

-- Create storage bucket policies
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES
  ('atlas-library', '.keep', NULL, '{}')
ON CONFLICT DO NOTHING;
