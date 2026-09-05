import React, { useMemo, useRef, useState } from 'react'
import Head from 'next/head'
import { MAX_UPLOAD_BYTES } from '../lib/design-requests/upload-validation'
import type { DesignType } from '../lib/design-requests/types'

/**
 * The permanent customer intake page.
 *
 * The QR code on the kiosk is physical and never changes — it always points
 * here, at /session. There is no session id in the URL, no account, and no
 * login: the customer picks what they are creating, fills in their details,
 * optionally attaches their logo and their own QR code, describes the look they
 * want, and submits. The server mints the request id.
 */

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp'

const DESIGN_INSTRUCTIONS_PLACEHOLDER =
  'Tell Atlas what you want your design to look like. For example: modern, luxury, black and gold, clean, professional.'

const colors = {
  background: '#0a1420',
  panel: 'rgba(255, 255, 255, 0.04)',
  border: 'rgba(0, 168, 243, 0.25)',
  danger: '#ff6b6b',
  accent: '#00a8f3',
  text: '#e6eef6',
  muted: 'rgba(230, 238, 246, 0.55)',
}

type FieldErrors = Record<string, string>

export default function SessionPage() {
  const [designType, setDesignType] = useState<DesignType | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [sent, setSent] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const [logoName, setLogoName] = useState<string | null>(null)
  const [qrName, setQrName] = useState<string | null>(null)

  const isFlyer = designType === 'flyer'

  const heading = useMemo(() => {
    if (!designType) return 'What would you like to create?'
    return isFlyer ? 'Tell Atlas about your flyer' : 'Tell Atlas about your business'
  }, [designType, isFlyer])

  if (sent) {
    return (
      <Shell title="Atlas — All set">
        <div style={{ textAlign: 'center', paddingTop: '72px' }}>
          <div style={{ fontSize: '52px', marginBottom: '20px' }}>✓</div>
          <h1 style={{ fontSize: '26px', margin: '0 0 12px' }}>You&apos;re all set!</h1>
          <p style={{ color: colors.muted, fontSize: '15px', lineHeight: 1.55 }}>
            Atlas has received your information. Your design is being prepared.
          </p>
        </div>
      </Shell>
    )
  }

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    setName: (name: string | null) => void
  ) => {
    const file = event.target.files?.[0]
    if (!file) {
      setName(null)
      return
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setError('That image is too large. Please choose one under 5 MB.')
      event.target.value = ''
      setName(null)
      return
    }

    setError(null)
    setName(file.name)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!designType || submitting) return

    const form = formRef.current
    if (!form) return

    const data = new FormData(form)
    data.set('design_type', designType)

    setSubmitting(true)
    setError(null)
    setFieldErrors({})

    try {
      const response = await fetch('/api/design-requests/submit', {
        method: 'POST',
        body: data,
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(payload?.error || 'Something went wrong. Please try again.')
        setFieldErrors(payload?.fieldErrors ?? {})
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }

      setSent(true)
    } catch (submitError) {
      console.error('[Session] Submit failed:', submitError)
      setError('We could not reach Atlas. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Shell title="Atlas — Create your design">
      <header style={{ marginBottom: '22px' }}>
        <p style={{ color: colors.accent, fontSize: '13px', letterSpacing: '1px', margin: 0 }}>
          ATLAS PRINTERS
        </p>
        <h1 style={{ fontSize: '25px', margin: '8px 0 0', lineHeight: 1.25 }}>{heading}</h1>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            background: 'rgba(139, 45, 45, 0.85)',
            color: '#fff',
            padding: '12px 14px',
            borderRadius: '10px',
            fontSize: '14px',
            marginBottom: '18px',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <ChoiceCard
          label="Business Card"
          hint="Your contact details on a card"
          selected={designType === 'business_card'}
          onSelect={() => setDesignType('business_card')}
        />
        <ChoiceCard
          label="Flyer"
          hint="Promote an event, offer or service"
          selected={designType === 'flyer'}
          onSelect={() => setDesignType('flyer')}
        />
      </div>

      {designType && (
        <form ref={formRef} onSubmit={handleSubmit} style={{ marginTop: '28px' }}>
          <Field
            label={isFlyer ? 'Business or organisation name' : 'Business name'}
            name="business_name"
            required
            maxLength={200}
            autoComplete="organization"
            error={fieldErrors.business_name}
          />

          {isFlyer ? (
            <>
              <Field
                label="Main title"
                name="main_title"
                maxLength={200}
                placeholder="The headline across the top of the flyer"
                error={fieldErrors.main_title}
              />
              <Field
                label="Description and details"
                name="description"
                maxLength={2000}
                multiline
                rows={5}
                placeholder="What is the flyer about? Dates, prices, offers, anything people should know."
                error={fieldErrors.description}
              />
            </>
          ) : (
            <>
              <Field
                label="Your name"
                name="person_name"
                maxLength={120}
                autoComplete="name"
                error={fieldErrors.person_name}
              />
              <Field
                label="Job title"
                name="job_title"
                maxLength={120}
                error={fieldErrors.job_title}
              />
            </>
          )}

          <Field
            label="Phone"
            name="phone"
            maxLength={40}
            type="tel"
            autoComplete="tel"
            error={fieldErrors.phone}
          />
          <Field
            label="Email"
            name="email"
            maxLength={200}
            type="email"
            autoComplete="email"
            error={fieldErrors.email}
          />
          <Field
            label="Website"
            name="website"
            maxLength={300}
            autoComplete="url"
            error={fieldErrors.website}
          />
          <Field
            label="Address"
            name="address"
            maxLength={300}
            multiline
            rows={2}
            error={fieldErrors.address}
          />
          <Field
            label="Social media"
            name="social_media"
            maxLength={500}
            multiline
            rows={2}
            placeholder="@yourbusiness on Instagram, facebook.com/yourbusiness…"
            error={fieldErrors.social_media}
          />

          <SectionLabel>Images — optional</SectionLabel>

          <FileField
            label="Your logo"
            name="logo"
            hint="PNG, JPEG or WebP · up to 5 MB"
            fileName={logoName}
            onChange={(e) => handleFileChange(e, setLogoName)}
          />

          <FileField
            label="Your QR code"
            name="customer_qr"
            hint="The QR code you want printed on your design"
            fileName={qrName}
            onChange={(e) => handleFileChange(e, setQrName)}
          />

          <SectionLabel>The look</SectionLabel>

          <Field
            label="How would you like your design to look?"
            name="design_instructions"
            maxLength={2000}
            multiline
            rows={5}
            placeholder={DESIGN_INSTRUCTIONS_PLACEHOLDER}
            error={fieldErrors.design_instructions}
          />

          <Field
            label="Any other information"
            name="additional_information"
            maxLength={2000}
            multiline
            rows={3}
            error={fieldErrors.additional_information}
          />

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '18px',
              fontSize: '17px',
              fontWeight: 600,
              color: submitting ? colors.muted : '#04121d',
              background: submitting ? 'rgba(0, 168, 243, 0.3)' : colors.accent,
              border: 'none',
              borderRadius: '12px',
              cursor: submitting ? 'default' : 'pointer',
              marginTop: '10px',
            }}
          >
            {submitting ? 'Sending…' : 'SUBMIT'}
          </button>

          <p style={{ color: colors.muted, fontSize: '12px', textAlign: 'center', marginTop: '14px' }}>
            Only the business name is required.
          </p>
        </form>
      )}
    </Shell>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="robots" content="noindex" />
      </Head>

      <main
        style={{
          minHeight: '100vh',
          background: `linear-gradient(180deg, ${colors.background} 0%, #0f1a2a 100%)`,
          color: colors.text,
          padding: '28px 18px 56px',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <div style={{ maxWidth: '520px', margin: '0 auto' }}>{children}</div>
      </main>

      <style>{`
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: ${colors.background}; }
        input, textarea, button { font-family: inherit; }
        input:focus, textarea:focus { outline: 2px solid ${colors.accent}; outline-offset: 1px; }
      `}</style>
    </>
  )
}

function ChoiceCard({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string
  hint: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        padding: '22px 16px',
        borderRadius: '14px',
        border: `2px solid ${selected ? colors.accent : colors.border}`,
        background: selected ? 'rgba(0, 168, 243, 0.14)' : colors.panel,
        color: colors.text,
        textAlign: 'left',
        cursor: 'pointer',
        minHeight: '108px',
      }}
    >
      <div style={{ fontSize: '17px', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '12px', color: colors.muted, marginTop: '6px', lineHeight: 1.4 }}>
        {hint}
      </div>
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '12px',
        letterSpacing: '1.2px',
        color: colors.accent,
        margin: '28px 0 12px',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  )
}

interface FieldProps {
  label: string
  name: string
  required?: boolean
  maxLength: number
  multiline?: boolean
  rows?: number
  type?: string
  placeholder?: string
  autoComplete?: string
  error?: string
}

function Field({
  label,
  name,
  required,
  maxLength,
  multiline,
  rows,
  type = 'text',
  placeholder,
  autoComplete,
  error,
}: FieldProps) {
  const sharedStyle: React.CSSProperties = {
    width: '100%',
    padding: '14px',
    fontSize: '16px', // 16px keeps iOS from zooming on focus
    color: colors.text,
    background: colors.panel,
    border: `1px solid ${error ? colors.danger : colors.border}`,
    borderRadius: '10px',
    marginTop: '6px',
  }

  return (
    <label style={{ display: 'block', marginBottom: '16px', fontSize: '14px', color: colors.muted }}>
      {label}
      {required && <span style={{ color: colors.accent }}> *</span>}
      {multiline ? (
        <textarea
          name={name}
          rows={rows ?? 3}
          maxLength={maxLength}
          placeholder={placeholder}
          required={required}
          aria-invalid={!!error}
          style={{ ...sharedStyle, resize: 'vertical' }}
        />
      ) : (
        <input
          name={name}
          type={type}
          maxLength={maxLength}
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
          aria-invalid={!!error}
          style={sharedStyle}
        />
      )}
      {error && (
        <span style={{ display: 'block', color: colors.danger, fontSize: '12px', marginTop: '5px' }}>
          {error}
        </span>
      )}
    </label>
  )
}

function FileField({
  label,
  name,
  hint,
  fileName,
  onChange,
}: {
  label: string
  name: string
  hint: string
  fileName: string | null
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label
      style={{
        display: 'block',
        marginBottom: '14px',
        padding: '16px',
        border: `1px dashed ${colors.border}`,
        borderRadius: '12px',
        background: colors.panel,
      }}
    >
      <div style={{ fontSize: '15px', color: colors.text }}>{label}</div>
      <div style={{ fontSize: '12px', color: colors.muted, marginTop: '4px' }}>
        {fileName ?? hint}
      </div>
      <input
        name={name}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        onChange={onChange}
        style={{ marginTop: '10px', fontSize: '13px', color: colors.muted, maxWidth: '100%' }}
      />
    </label>
  )
}
