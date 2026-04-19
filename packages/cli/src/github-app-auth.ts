import { createSign } from 'node:crypto'

const GITHUB_API = 'https://api.github.com'

function base64UrlEncode(value: Buffer | string): string {
  const buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function extractGitHubRepoSlug(repoUrl: string): string | null {
  const sshMatch = repoUrl.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/)
  if (sshMatch?.[1]) return sshMatch[1]

  const httpsMatch = repoUrl.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/)?$/)
  if (httpsMatch?.[1]) return httpsMatch[1]

  return null
}

function generateGitHubAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64UrlEncode(JSON.stringify({
    iat: now - 60,
    exp: now + 600,
    iss: appId,
  }))
  const signingInput = `${header}.${payload}`

  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()

  const signature = signer.sign(privateKey)
  return `${signingInput}.${base64UrlEncode(signature)}`
}

export async function getGitHubAppInstallationToken(installationId: number): Promise<string> {
  const appId = process.env['GITHUB_APP_ID']?.trim()
  const privateKey = process.env['GITHUB_APP_PRIVATE_KEY']?.trim()
  if (!appId || !privateKey) {
    throw new Error('github_app repo auth requested but the launch runner is missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY')
  }

  const jwt = generateGitHubAppJwt(appId, privateKey)
  const response = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'wanman-launch-runner',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to get GitHub App installation token (${response.status})`)
  }

  const payload = await response.json() as { token?: string }
  if (!payload.token) {
    throw new Error('GitHub App installation token response did not include a token')
  }

  return payload.token
}
