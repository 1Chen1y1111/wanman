import { describe, it, expect } from 'vitest'
import {
  ECHO_AGENT, PING_AGENT, TEST_AGENTS,
  CEO_AGENT, FINANCE_AGENT, DEVOPS_AGENT,
  MARKETING_AGENT, FEEDBACK_AGENT, DEV_AGENT,
  PRODUCTION_AGENTS,
} from './registry.js'

describe('ECHO_AGENT', () => {
  it('should have correct name', () => {
    expect(ECHO_AGENT.name).toBe('echo')
  })

  it('should be a 24/7 agent', () => {
    expect(ECHO_AGENT.lifecycle).toBe('24/7')
  })

  it('should use haiku model', () => {
    expect(ECHO_AGENT.model).toBe('haiku')
  })

  it('should have a system prompt with wanman CLI instructions', () => {
    expect(ECHO_AGENT.systemPrompt).toContain('wanman recv')
    expect(ECHO_AGENT.systemPrompt).toContain('wanman send')
    expect(ECHO_AGENT.systemPrompt).toContain('echo')
  })
})

describe('PING_AGENT', () => {
  it('should have correct name', () => {
    expect(PING_AGENT.name).toBe('ping')
  })

  it('should be an on-demand agent', () => {
    expect(PING_AGENT.lifecycle).toBe('on-demand')
  })

  it('should use haiku model', () => {
    expect(PING_AGENT.model).toBe('haiku')
  })

  it('should have a system prompt mentioning pong', () => {
    expect(PING_AGENT.systemPrompt).toContain('pong')
  })
})

describe('TEST_AGENTS', () => {
  it('should contain both echo and ping agents', () => {
    expect(TEST_AGENTS).toHaveLength(2)
    expect(TEST_AGENTS[0]).toBe(ECHO_AGENT)
    expect(TEST_AGENTS[1]).toBe(PING_AGENT)
  })

  it('should have unique names', () => {
    const names = TEST_AGENTS.map(a => a.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

// =========================================================================
// Production Agents
// =========================================================================

describe('CEO_AGENT', () => {
  it('should have correct name and lifecycle', () => {
    expect(CEO_AGENT.name).toBe('ceo')
    expect(CEO_AGENT.lifecycle).toBe('24/7')
  })

  it('should use sonnet model', () => {
    expect(CEO_AGENT.model).toBe('sonnet')
  })

  it('should have morning briefing cron', () => {
    expect(CEO_AGENT.crons).toContain('0 8 * * *')
  })

  it('should subscribe to human_query events', () => {
    expect(CEO_AGENT.events).toContain('human_query')
  })

  it('should have a system prompt with role description', () => {
    expect(CEO_AGENT.systemPrompt).toContain('CEO Agent')
    expect(CEO_AGENT.systemPrompt).toContain('ceo')
  })
})

describe('FINANCE_AGENT', () => {
  it('should have correct name and lifecycle', () => {
    expect(FINANCE_AGENT.name).toBe('finance')
    expect(FINANCE_AGENT.lifecycle).toBe('24/7')
  })

  it('should use haiku model', () => {
    expect(FINANCE_AGENT.model).toBe('haiku')
  })

  it('should have daily and weekly crons', () => {
    expect(FINANCE_AGENT.crons).toContain('0 9 * * *')
    expect(FINANCE_AGENT.crons).toContain('0 9 * * 1')
  })

  it('should subscribe to stripe_webhook events', () => {
    expect(FINANCE_AGENT.events).toContain('stripe_webhook')
  })
})

describe('DEVOPS_AGENT', () => {
  it('should have correct name and lifecycle', () => {
    expect(DEVOPS_AGENT.name).toBe('devops')
    expect(DEVOPS_AGENT.lifecycle).toBe('24/7')
  })

  it('should use haiku model', () => {
    expect(DEVOPS_AGENT.model).toBe('haiku')
  })

  it('should have hourly cron for health checks', () => {
    expect(DEVOPS_AGENT.crons).toContain('0 * * * *')
  })

  it('should subscribe to deploy_webhook events', () => {
    expect(DEVOPS_AGENT.events).toContain('deploy_webhook')
  })
})

describe('MARKETING_AGENT', () => {
  it('should have correct name and lifecycle', () => {
    expect(MARKETING_AGENT.name).toBe('marketing')
    expect(MARKETING_AGENT.lifecycle).toBe('24/7')
  })

  it('should use haiku model', () => {
    expect(MARKETING_AGENT.model).toBe('haiku')
  })

  it('should have daily cron', () => {
    expect(MARKETING_AGENT.crons).toContain('0 10 * * *')
  })

  it('should subscribe to github_push events', () => {
    expect(MARKETING_AGENT.events).toContain('github_push')
  })
})

describe('FEEDBACK_AGENT', () => {
  it('should have correct name and lifecycle', () => {
    expect(FEEDBACK_AGENT.name).toBe('feedback')
    expect(FEEDBACK_AGENT.lifecycle).toBe('24/7')
  })

  it('should use haiku model', () => {
    expect(FEEDBACK_AGENT.model).toBe('haiku')
  })

  it('should have daily cron', () => {
    expect(FEEDBACK_AGENT.crons).toContain('0 11 * * *')
  })

  it('should subscribe to github_issue and email_webhook events', () => {
    expect(FEEDBACK_AGENT.events).toContain('github_issue')
    expect(FEEDBACK_AGENT.events).toContain('email_webhook')
  })
})

describe('DEV_AGENT', () => {
  it('should have correct name and on-demand lifecycle', () => {
    expect(DEV_AGENT.name).toBe('dev')
    expect(DEV_AGENT.lifecycle).toBe('on-demand')
  })

  it('should use sonnet model (complex coding tasks)', () => {
    expect(DEV_AGENT.model).toBe('sonnet')
  })

  it('should have no crons (on-demand only)', () => {
    expect(DEV_AGENT.crons).toBeUndefined()
  })

  it('should have no event subscriptions', () => {
    expect(DEV_AGENT.events).toBeUndefined()
  })
})

describe('PRODUCTION_AGENTS', () => {
  it('should contain all 7 production agents', () => {
    expect(PRODUCTION_AGENTS).toHaveLength(7)
  })

  it('should have unique names', () => {
    const names = PRODUCTION_AGENTS.map(a => a.name)
    expect(new Set(names).size).toBe(7)
  })

  it('should include all expected agents', () => {
    const names = PRODUCTION_AGENTS.map(a => a.name).sort()
    expect(names).toEqual(['ceo', 'cto', 'dev', 'devops', 'feedback', 'finance', 'marketing'])
  })

  it('should be in recommended startup order (CEO first)', () => {
    expect(PRODUCTION_AGENTS[0]).toBe(CEO_AGENT)
  })

  it('should have no overlap with TEST_AGENTS names', () => {
    const prodNames = new Set(PRODUCTION_AGENTS.map(a => a.name))
    const testNames = TEST_AGENTS.map(a => a.name)
    for (const name of testNames) {
      expect(prodNames.has(name)).toBe(false)
    }
  })

  it('should all have system prompts with wanman recv instructions', () => {
    for (const agent of PRODUCTION_AGENTS) {
      expect(agent.systemPrompt).toContain('wanman recv')
    }
  })

  it('should have correct model distribution (3 sonnet, 4 haiku)', () => {
    const sonnetAgents = PRODUCTION_AGENTS.filter(a => a.model === 'sonnet')
    const haikuAgents = PRODUCTION_AGENTS.filter(a => a.model === 'haiku')
    expect(sonnetAgents).toHaveLength(3)
    expect(haikuAgents).toHaveLength(4)
  })

  it('should have correct lifecycle distribution (5 24/7, 2 on-demand)', () => {
    const alwaysOn = PRODUCTION_AGENTS.filter(a => a.lifecycle === '24/7')
    const onDemand = PRODUCTION_AGENTS.filter(a => a.lifecycle === 'on-demand')
    expect(alwaysOn).toHaveLength(5)
    expect(onDemand).toHaveLength(2)
    const onDemandNames = onDemand.map(a => a.name).sort()
    expect(onDemandNames).toEqual(['cto', 'dev'])
  })
})
