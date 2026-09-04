import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { FileRecord } from '../lib/db'

interface LibraryDashboardProps {
  onAddKnowledge: () => void
}

interface CategoryInfo {
  id: string
  name: string
  icon: string
  description: string
  path: string
  count: number
}

export const LibraryDashboard = forwardRef<{ refetch: () => Promise<void> }, LibraryDashboardProps>(
  ({ onAddKnowledge }, ref) => {
  const [search, setSearch] = useState('')
  const [files, setFiles] = useState<FileRecord[]>([])
  const [filteredFiles, setFilteredFiles] = useState<FileRecord[]>([])
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null)
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const categories: CategoryInfo[] = [
    {
      id: 'Business',
      name: 'Business',
      icon: '💼',
      description: 'Business books and pricing documents.',
      path: 'knowledge/Business/',
      count: 0,
    },
    {
      id: 'Printing',
      name: 'Printing',
      icon: '🖨️',
      description: 'Printing-related books and resources.',
      path: 'knowledge/Printing/',
      count: 0,
    },
    {
      id: 'Personal',
      name: 'Personal',
      icon: '📝',
      description: 'Personal notes and references.',
      path: 'knowledge/Personal/',
      count: 0,
    },
  ]

  useEffect(() => {
    fetchFiles()
  }, [])

  const fetchFiles = async () => {
    try {
      const res = await fetch('/api/library/files')
      if (res.ok) {
        const data = await res.json()
        setFiles(data.files)
        setCategoryCounts(data.counts)
        setFilteredFiles(data.files)
      }
    } catch (error) {
      console.error('Failed to fetch files:', error)
    } finally {
      setLoading(false)
    }
  }

  useImperativeHandle(ref, () => ({
    refetch: fetchFiles,
  }))

  useEffect(() => {
    if (search.trim() === '') {
      setFilteredFiles(files)
    } else {
      const query = search.toLowerCase()
      setFilteredFiles(
        files.filter(
          (f) =>
            f.name.toLowerCase().includes(query) ||
            f.category.toLowerCase().includes(query) ||
            f.type.toLowerCase().includes(query)
        )
      )
    }
  }, [search, files])

  const handleDeleteFile = async (id: string) => {
    if (!window.confirm('Delete this memory?\n\nThis will permanently remove it from the Memory Library.')) {
      return
    }

    try {
      const res = await fetch(`/api/library/files/${id}`, { method: 'DELETE' })
      if (res.ok) {
        // Refresh files and counts
        await fetchFiles()
        setSelectedFile(null)
      } else {
        const data = await res.json()
        alert('Failed to delete file: ' + (data.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to delete file:', error)
      alert('Failed to delete file. Please try again.')
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + ' ' + sizes[i]
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const getFileIcon = (type: string) => {
    const iconMap: Record<string, string> = {
      book: '📕',
      note: '📄',
      research: '🔬',
      manual: '📖',
      pricing: '💳',
      project: '💼',
      decision: '⚖️',
    }
    return iconMap[type.toLowerCase()] || '📄'
  }

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'ready':
        return { icon: '✓', label: 'Ready', color: '#10b981' }
      case 'processing':
        return { icon: '⏳', label: 'Processing...', color: '#f59e0b' }
      case 'failed':
        return { icon: '⚠️', label: 'Failed', color: '#ef4444' }
      default:
        return { icon: '⊙', label: 'Pending', color: '#6b7280' }
    }
  }

  const handleProcessFile = async (id: string) => {
    try {
      const res = await fetch(`/api/library/process/${id}`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        console.log('File processed:', data)
        // Refresh file list to get updated status
        await fetchFiles()
        // Update selected file
        const updated = getFile(id)
        if (updated) {
          setSelectedFile(updated)
        }
      } else {
        const data = await res.json()
        alert('Processing failed: ' + (data.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to process file:', error)
      alert('Failed to process file. Check console for details.')
    }
  }

  const getFile = (id: string) => {
    return files.find((f) => f.id === id)
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(180deg, #071021 0%, #0e1a2a 100%)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '32px 40px',
          borderBottom: '1px solid rgba(0, 168, 243, 0.1)',
          background: 'rgba(7, 16, 33, 0.6)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <h1
          style={{
            margin: '0 0 8px 0',
            fontSize: '32px',
            fontWeight: 600,
            color: '#e6eef6',
          }}
        >
          Memory Library
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: '14px',
            color: 'rgba(230, 238, 246, 0.7)',
          }}
        >
          Build a personal knowledge base about this person.
        </p>

        {/* Search and Add */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            marginTop: '20px',
          }}
        >
          <div
            style={{
              flex: 1,
              position: 'relative',
            }}
          >
            <input
              type="text"
              placeholder="Search memories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 16px',
                background: 'rgba(15, 23, 32, 0.8)',
                border: '1px solid rgba(0, 168, 243, 0.2)',
                borderRadius: '6px',
                color: '#e6eef6',
                fontSize: '14px',
                backdropFilter: 'blur(4px)',
                transition: 'all 0.2s ease-out',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.5)'
                e.currentTarget.style.background = 'rgba(15, 23, 32, 0.95)'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.2)'
                e.currentTarget.style.background = 'rgba(15, 23, 32, 0.8)'
              }}
            />
          </div>
          <button
            onClick={onAddKnowledge}
            style={{
              padding: '10px 20px',
              background: 'linear-gradient(135deg, #00a8f3 0%, #0077cc 100%)',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s ease-out',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 168, 243, 0.4)'
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'none'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            + Add Memory
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '32px 40px',
        }}
      >
        {loading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '200px',
              color: 'rgba(230, 238, 246, 0.5)',
            }}
          >
            Loading...
          </div>
        ) : (
          <>
            {/* Categories Section */}
            <div style={{ marginBottom: '48px' }}>
              <h2
                style={{
                  margin: '0 0 20px 0',
                  fontSize: '16px',
                  fontWeight: 600,
                  color: '#e6eef6',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  opacity: 0.8,
                }}
              >
                Memory Categories
              </h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '16px',
                }}
              >
                {categories.map((category) => (
                  <div
                    key={category.id}
                    style={{
                      padding: '20px',
                      background: 'rgba(15, 23, 32, 0.6)',
                      border: '1px solid rgba(0, 168, 243, 0.15)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease-out',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(15, 23, 32, 0.9)'
                      e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.3)'
                      e.currentTarget.style.transform = 'translateY(-4px)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(15, 23, 32, 0.6)'
                      e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.15)'
                      e.currentTarget.style.transform = 'translateY(0)'
                    }}
                  >
                    <div style={{ fontSize: '28px', marginBottom: '12px' }}>{category.icon}</div>
                    <h3
                      style={{
                        margin: '0 0 4px 0',
                        fontSize: '16px',
                        fontWeight: 600,
                        color: '#e6eef6',
                      }}
                    >
                      {category.name}
                    </h3>
                    <p
                      style={{
                        margin: '0 0 12px 0',
                        fontSize: '12px',
                        color: 'rgba(230, 238, 246, 0.7)',
                      }}
                    >
                      {categoryCounts[category.id] || 0} files
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: '13px',
                        color: 'rgba(230, 238, 246, 0.6)',
                        lineHeight: '1.5',
                      }}
                    >
                      {category.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Files Section */}
            <div>
              <h2
                style={{
                  margin: '0 0 20px 0',
                  fontSize: '16px',
                  fontWeight: 600,
                  color: '#e6eef6',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  opacity: 0.8,
                }}
              >
                {search ? `Search Results (${filteredFiles.length})` : `All Memories (${filteredFiles.length})`}
              </h2>

              {filteredFiles.length === 0 ? (
                <div
                  style={{
                    padding: '48px 24px',
                    textAlign: 'center',
                    color: 'rgba(230, 238, 246, 0.5)',
                  }}
                >
                  <p style={{ margin: '0 0 12px 0', fontSize: '16px' }}>
                    {search ? 'No files found.' : 'Your Memory Library is empty.'}
                  </p>
                  {!search && (
                    <p style={{ margin: 0, fontSize: '13px' }}>
                      Add documents, stories, photos, and memories to build a personal knowledge base about this person.
                    </p>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  {filteredFiles.map((file) => (
                    <div
                      key={file.id}
                      onClick={() => setSelectedFile(file)}
                      style={{
                        padding: '16px',
                        background: selectedFile?.id === file.id ? 'rgba(0, 168, 243, 0.1)' : 'rgba(15, 23, 32, 0.5)',
                        border:
                          selectedFile?.id === file.id
                            ? '1px solid rgba(0, 168, 243, 0.3)'
                            : '1px solid rgba(0, 168, 243, 0.1)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease-out',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(15, 23, 32, 0.8)'
                        e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.2)'
                      }}
                      onMouseLeave={(e) => {
                        if (selectedFile?.id !== file.id) {
                          e.currentTarget.style.background = 'rgba(15, 23, 32, 0.5)'
                          e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.1)'
                        }
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '18px' }}>{getFileIcon(file.type)}</span>
                          <div style={{ flex: 1 }}>
                            <h4 style={{ margin: '0 0 2px 0', color: '#e6eef6', fontSize: '14px', fontWeight: 500 }}>
                              {file.name}
                            </h4>
                            <p style={{ margin: 0, color: 'rgba(230, 238, 246, 0.6)', fontSize: '12px' }}>
                              {file.category} • {file.type}
                            </p>
                          </div>
                          {(() => {
                            const badge = getStatusBadge(file.processing_status)
                            return (
                              <span
                                style={{
                                  fontSize: '11px',
                                  color: badge.color,
                                  fontWeight: 500,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {badge.icon} {badge.label}
                              </span>
                            )
                          })()}
                        </div>
                        <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                          <span style={{ fontSize: '12px', color: 'rgba(230, 238, 246, 0.5)' }}>
                            {formatBytes(file.size)}
                          </span>
                          <span style={{ fontSize: '12px', color: 'rgba(230, 238, 246, 0.5)' }}>
                            Added {formatDate(file.created_at)}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          // Menu button for future use
                        }}
                        style={{
                          padding: '6px 12px',
                          background: 'transparent',
                          border: '1px solid rgba(0, 168, 243, 0.2)',
                          borderRadius: '4px',
                          color: 'rgba(230, 238, 246, 0.7)',
                          cursor: 'pointer',
                          fontSize: '12px',
                          transition: 'all 0.2s ease-out',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.5)'
                          e.currentTarget.style.color = '#e6eef6'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.2)'
                          e.currentTarget.style.color = 'rgba(230, 238, 246, 0.7)'
                        }}
                      >
                        ⋮
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* File Details Modal */}
      {selectedFile && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedFile(null)
            }
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              background: 'linear-gradient(180deg, #0a1420 0%, #0f1a2a 100%)',
              border: '1px solid rgba(0, 168, 243, 0.2)',
              borderRadius: '8px',
              padding: '32px',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
              <span style={{ fontSize: '32px' }}>{getFileIcon(selectedFile.type)}</span>
              <div>
                <h2 style={{ margin: 0, color: '#e6eef6', fontSize: '20px' }}>{selectedFile.name}</h2>
                <p style={{ margin: '4px 0 0 0', color: 'rgba(230, 238, 246, 0.6)', fontSize: '12px' }}>
                  {selectedFile.category} • {selectedFile.type}
                </p>
              </div>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <div style={{ marginBottom: '12px' }}>
                <p style={{ margin: '0 0 4px 0', color: 'rgba(230, 238, 246, 0.6)', fontSize: '12px', textTransform: 'uppercase' }}>
                  Location
                </p>
                <p style={{ margin: 0, color: '#e6eef6', fontSize: '13px', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                  {selectedFile.path}
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
                <div>
                  <p style={{ margin: '0 0 4px 0', color: 'rgba(230, 238, 246, 0.6)', fontSize: '12px', textTransform: 'uppercase' }}>
                    Size
                  </p>
                  <p style={{ margin: 0, color: '#e6eef6', fontSize: '13px' }}>
                    {formatBytes(selectedFile.size)}
                  </p>
                </div>
                <div>
                  <p style={{ margin: '0 0 4px 0', color: 'rgba(230, 238, 246, 0.6)', fontSize: '12px', textTransform: 'uppercase' }}>
                    Added
                  </p>
                  <p style={{ margin: 0, color: '#e6eef6', fontSize: '13px' }}>
                    {formatDate(selectedFile.created_at)}
                  </p>
                </div>
              </div>
            </div>

            {/* Processing Status Section */}
            <div style={{ marginBottom: '24px', padding: '12px', background: 'rgba(0, 168, 243, 0.05)', borderRadius: '6px', border: '1px solid rgba(0, 168, 243, 0.2)' }}>
              {(() => {
                const badge = getStatusBadge(selectedFile.processing_status)
                return (
                  <div>
                    <p style={{ margin: '0 0 8px 0', color: 'rgba(230, 238, 246, 0.6)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Memory Processing
                    </p>
                    <p style={{ margin: 0, color: badge.color, fontSize: '13px', fontWeight: 500 }}>
                      {badge.icon} {badge.label}
                    </p>
                  </div>
                )
              })()}
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              {selectedFile.processing_status !== 'processing' && selectedFile.processing_status !== 'ready' && (
                <button
                  onClick={() => {
                    handleProcessFile(selectedFile.id)
                  }}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    background: 'linear-gradient(135deg, #00a8f3 0%, #0077cc 100%)',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 500,
                    transition: 'all 0.2s ease-out',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 168, 243, 0.4)'
                    e.currentTarget.style.transform = 'translateY(-2px)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = 'none'
                    e.currentTarget.style.transform = 'translateY(0)'
                  }}
                >
                  📖 Read Memory
                </button>
              )}
              <button
                onClick={() => setSelectedFile(null)}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  background: 'transparent',
                  border: '1px solid rgba(0, 168, 243, 0.2)',
                  borderRadius: '6px',
                  color: '#e6eef6',
                  cursor: 'pointer',
                  fontSize: '14px',
                  transition: 'all 0.2s ease-out',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.5)'
                  e.currentTarget.style.background = 'rgba(0, 168, 243, 0.05)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.2)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                Close
              </button>
              <button
                onClick={() => {
                  handleDeleteFile(selectedFile.id)
                }}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  background: 'rgba(220, 53, 69, 0.1)',
                  border: '1px solid rgba(220, 53, 69, 0.3)',
                  borderRadius: '6px',
                  color: '#dc3545',
                  cursor: 'pointer',
                  fontSize: '14px',
                  transition: 'all 0.2s ease-out',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(220, 53, 69, 0.2)'
                  e.currentTarget.style.borderColor = 'rgba(220, 53, 69, 0.5)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(220, 53, 69, 0.1)'
                  e.currentTarget.style.borderColor = 'rgba(220, 53, 69, 0.3)'
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
  }
)

LibraryDashboard.displayName = 'LibraryDashboard'

export default LibraryDashboard
