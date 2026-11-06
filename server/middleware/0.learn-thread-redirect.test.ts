import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
const handler = (await import('./0.learn-thread-redirect')).default
const sendRedirect = vi.fn()
const setResponseHeader = vi.fn()

function request(path: string, method = 'GET') {
  const event = { method, path }
  return { event, result: handler(event as never) }
}

beforeEach(() => {
  sendRedirect.mockReset().mockReturnValue('redirected')
  setResponseHeader.mockReset()
  vi.stubGlobal('sendRedirect', sendRedirect)
  vi.stubGlobal('setResponseHeader', setResponseHeader)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('legacy adaptive Void entry', () => {
  test.each(['GET', 'HEAD'])('%s answers 302 no-store and changes only the matched prefix', (method) => {
    const query = '?activity=activity%2F1&utm_source=mail&empty=&flag&repeat=1&repeat=2&space=a+b%20c&next=https%3A%2F%2Fexample.com'
    const { event, result } = request(`/app/learn/thread/k57thread%2F%2541${query}`, method)
    expect(result).toBe('redirected')
    expect(setResponseHeader).toHaveBeenCalledWith(event, 'cache-control', 'no-store')
    expect(sendRedirect).toHaveBeenCalledWith(event, `/app/learn/void/k57thread%2F%2541${query}`, 302)
  })

  test('keeps a trailing slash and accepts the router case-insensitive prefix', () => {
    const { event } = request('/App/Learn/Thread/thread_1/?activity=older')
    expect(sendRedirect).toHaveBeenCalledWith(event, '/app/learn/void/thread_1/?activity=older', 302)
  })

  test('never emits a fragment or a destination taken from query input', () => {
    request('/app/learn/thread/thread_1?redirect=%2F%2Fevil.example&to=https://evil.example#learn-thread-history-title')
    const location = sendRedirect.mock.calls[0]?.[1] as string
    expect(location).toBe('/app/learn/void/thread_1?redirect=%2F%2Fevil.example&to=https://evil.example')
    expect(location).not.toContain('#')
  })

  test('percent-encodes raw unsafe characters instead of reflecting them', () => {
    request('/app/learn/thread/a"<b>?q="<x>\'')
    expect(sendRedirect.mock.calls[0]?.[1]).toBe('/app/learn/void/a%22%3Cb%3E?q=%22%3Cx%3E%27')
  })

  test.each([
    ['POST', '/app/learn/thread/thread_1'],
    ['GET', '/app/learn/thread'],
    ['GET', '/app/learn/thread/'],
    ['GET', '/app/learn/thread/thread_1/activity_1'],
    ['GET', '/app/learn/thread/..'],
    ['GET', '/app/learn/threads/thread_1'],
    ['GET', '/app/learn/void/thread_1?activity=activity_1'],
    ['GET', '/app/learn/k57learningvoid'],
    ['GET', '/api/app/learn/thread/thread_1'],
  ])('leaves %s %s to the application', (method, path) => {
    expect(request(path, method).result).toBeUndefined()
    expect(sendRedirect).not.toHaveBeenCalled()
    expect(setResponseHeader).not.toHaveBeenCalled()
  })
})
