import { brandingService, DEFAULT_BRANDING } from '../services/branding/branding.service.js'
import { prisma } from '../lib/prisma.js'
import { sendEmail } from '../lib/mailer.js'
import { buildWelcomeTemplate } from '../lib/emailTemplates.js'

async function runE2E() {
  console.log('🚀 Starting Dynamic Branding End-to-End Verification...')

  try {
    // 1. Fetch current branding
    const initial = await brandingService.getBrandingConfig()
    console.log('✅ Step 1: Initial branding retrieved successfully:', {
      siteName: initial.siteName,
      tagline: initial.tagline,
      primaryColor: initial.primaryColor,
    })

    // 2. Apply a test dynamic branding update
    console.log('🔄 Step 2: Applying dynamic branding test update...')
    const updated = await brandingService.updateBrandingConfig({
      siteName: 'Revvie Dynamic Test',
      tagline: 'FEEL THE ASPHALT 🏍️',
      primaryColor: '#ff1d2d',
      emailHeaderBadge: 'LIVE SYSTEM VERIFICATION',
    })

    console.log('✅ Step 2: Branding updated in DB and cache invalidated:', {
      siteName: updated.siteName,
      tagline: updated.tagline,
      emailHeaderBadge: updated.emailHeaderBadge,
    })

    // 3. Verify in-memory cache returns the fresh values
    const cachedFresh = await brandingService.getBrandingConfig()
    if (cachedFresh.tagline !== 'FEEL THE ASPHALT 🏍️') {
      throw new Error(`Cache mismatch: expected 'FEEL THE ASPHALT 🏍️', got '${cachedFresh.tagline}'`)
    }
    console.log('✅ Step 3: Cached read reflects fresh branding without restart.')

    // 4. Send test transactional email to user's address using the dynamic template
    console.log('📧 Step 4: Dispatching dynamic transactional email to creativekrithik@gmail.com...')
    const template = buildWelcomeTemplate({
      name: 'Krithik (Admin)',
      appUrl: cachedFresh.siteUrl,
    }, cachedFresh)

    const sent = await sendEmail({
      to: 'creativekrithik@gmail.com',
      subject: `[Brand E2E] ${template.subject}`,
      html: template.html,
      text: template.text,
      tags: ['brand-e2e-test'],
      branding: cachedFresh,
    })

    if (!sent) {
      throw new Error('Failed to dispatch test email via Brevo')
    }
    console.log('✅ Step 4: Test email successfully sent via Brevo to creativekrithik@gmail.com!')

    // 5. Restore production defaults
    console.log('🧹 Step 5: Restoring production canonical defaults...')
    const restored = await brandingService.updateBrandingConfig(DEFAULT_BRANDING)
    console.log('✅ Step 5: Restored defaults successfully:', {
      siteName: restored.siteName,
      tagline: restored.tagline,
      emailHeaderBadge: restored.emailHeaderBadge,
    })

    console.log('🎉 ALL DYNAMIC BRANDING E2E VERIFICATIONS PASSED!')
  } catch (err) {
    console.error('❌ E2E Verification failed:', err)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

runE2E()
