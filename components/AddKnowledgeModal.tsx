import React, { useState } from 'react'

interface AddKnowledgeModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const CATEGORY_TYPES: Record<string, string[]> = {
  Business: ['Book', 'Pricing'],
  Printing: ['Book'],
  Personal: ['Note'],
}

export const AddKnowledgeModal: React.FC<AddKnowledgeModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [category, setCategory] = useState<string>('Business')
  const [type, setType] = useState<string>('Document')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCategoryChange = (newCategory: string) => {
    setCategory(newCategory)
    const types = CATEGORY_TYPES[newCategory]
    setType(types[0])
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0]

      // Validate file type
      const allowedExtensions = ['pdf', 'txt', 'md', 'docx', 'doc']
      const fileExtension = selectedFile.name.split('.').pop()?.toLowerCase()

      if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
        setError('Only PDF, TXT, MD, and DOCX files are supported.')
        return
      }

      setFile(selectedFile)
      setError(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!file) {
      setError('Please select a file.')
      return
    }

    setUploading(true)
    setError(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('category', category)
    formData.append('type', type)

    try {
      const res = await fetch('/api/library/upload', {
        method: 'POST',
        body: formData,
      })

      if (res.ok) {
        setFile(null)
        setCategory('Business')
        setType('Document')
        onClose()
        onSuccess()
      } else {
        const data = await res.json()
        setError(data.error || 'Upload failed.')
      }
    } catch (err) {
      setError('Upload failed. Please try again.')
      console.error(err)
    } finally {
      setUploading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !uploading) {
          onClose()
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
        <h2 style={{ margin: '0 0 24px 0', color: '#e6eef6', fontSize: '24px', fontWeight: 600 }}>
          Add Memory
        </h2>

        <form onSubmit={handleSubmit}>
          {/* Category */}
          <div style={{ marginBottom: '20px' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '8px',
                color: 'rgba(230, 238, 246, 0.8)',
                fontSize: '13px',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Category
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {Object.keys(CATEGORY_TYPES).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => handleCategoryChange(cat)}
                  style={{
                    padding: '10px 12px',
                    background: category === cat ? 'rgba(0, 168, 243, 0.2)' : 'rgba(15, 23, 32, 0.8)',
                    border: category === cat ? '1px solid rgba(0, 168, 243, 0.5)' : '1px solid rgba(0, 168, 243, 0.2)',
                    borderRadius: '6px',
                    color: category === cat ? '#00a8f3' : '#e6eef6',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                    transition: 'all 0.2s ease-out',
                  }}
                  onMouseEnter={(e) => {
                    if (category !== cat) {
                      e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.4)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (category !== cat) {
                      e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.2)'
                    }
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Type */}
          <div style={{ marginBottom: '20px' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '8px',
                color: 'rgba(230, 238, 246, 0.8)',
                fontSize: '13px',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Type
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {CATEGORY_TYPES[category].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  style={{
                    padding: '8px 16px',
                    background: type === t ? 'rgba(0, 168, 243, 0.2)' : 'rgba(15, 23, 32, 0.8)',
                    border: type === t ? '1px solid rgba(0, 168, 243, 0.5)' : '1px solid rgba(0, 168, 243, 0.2)',
                    borderRadius: '6px',
                    color: type === t ? '#00a8f3' : '#e6eef6',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 500,
                    transition: 'all 0.2s ease-out',
                  }}
                  onMouseEnter={(e) => {
                    if (type !== t) {
                      e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.4)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (type !== t) {
                      e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.2)'
                    }
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* File Upload */}
          <div style={{ marginBottom: '20px' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '8px',
                color: 'rgba(230, 238, 246, 0.8)',
                fontSize: '13px',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              File
            </label>
            <div
              style={{
                position: 'relative',
                padding: '20px',
                background: 'rgba(15, 23, 32, 0.6)',
                border: '2px dashed rgba(0, 168, 243, 0.3)',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s ease-out',
                textAlign: 'center',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.6)'
                e.currentTarget.style.background = 'rgba(15, 23, 32, 0.9)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.3)'
                e.currentTarget.style.background = 'rgba(15, 23, 32, 0.6)'
              }}
              onClick={() => {
                const input = document.getElementById('file-input') as HTMLInputElement
                input?.click()
              }}
            >
              <input
                id="file-input"
                type="file"
                onChange={handleFileChange}
                style={{ display: 'none' }}
                accept=".pdf,.txt,.md,.docx,.doc"
                disabled={uploading}
              />
              <p
                style={{
                  margin: '0 0 4px 0',
                  color: '#e6eef6',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
              >
                {file ? file.name : 'Click to select or drag file'}
              </p>
              <p
                style={{
                  margin: 0,
                  color: 'rgba(230, 238, 246, 0.5)',
                  fontSize: '12px',
                }}
              >
                PDF, TXT, MD, DOCX
              </p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                padding: '12px',
                background: 'rgba(220, 53, 69, 0.1)',
                border: '1px solid rgba(220, 53, 69, 0.3)',
                borderRadius: '6px',
                color: '#dc3545',
                fontSize: '12px',
                marginBottom: '20px',
              }}
            >
              {error}
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: 'transparent',
                border: '1px solid rgba(0, 168, 243, 0.2)',
                borderRadius: '6px',
                color: '#e6eef6',
                cursor: uploading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 500,
                transition: 'all 0.2s ease-out',
                opacity: uploading ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!uploading) {
                  e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.5)'
                  e.currentTarget.style.background = 'rgba(0, 168, 243, 0.05)'
                }
              }}
              onMouseLeave={(e) => {
                if (!uploading) {
                  e.currentTarget.style.borderColor = 'rgba(0, 168, 243, 0.2)'
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || !file}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: file && !uploading ? 'linear-gradient(135deg, #00a8f3 0%, #0077cc 100%)' : 'rgba(0, 168, 243, 0.3)',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                cursor: uploading || !file ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 500,
                transition: 'all 0.2s ease-out',
                opacity: uploading ? 0.7 : 1,
              }}
              onMouseEnter={(e) => {
                if (file && !uploading) {
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 168, 243, 0.4)'
                  e.currentTarget.style.transform = 'translateY(-2px)'
                }
              }}
              onMouseLeave={(e) => {
                if (file && !uploading) {
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.transform = 'translateY(0)'
                }
              }}
            >
              {uploading ? 'Uploading...' : 'Add File'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddKnowledgeModal
