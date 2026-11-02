import { test, expect } from '@playwright/test';
async function seed(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('tab', { name: /Session library/ }).click();
  await page.getByRole('button', { name: 'Load recorded fixture', exact: true }).click();
  await expect(page.locator('#session-origin')).toHaveText('RECORDED FIXTURE · NO MODEL RUN');
  await expect(page.locator('#messages .history-message')).toHaveCount(2);
}
test('SDK-hosted inspection shows actual MCP discovery and call evidence', async ({ page }) => {
  await page.goto('/');
  await page.locator('#inspect').click();
  await expect(page.locator('#connection-status')).toHaveText('Connected');
  await expect(page.locator('#connection-result')).toContainText('get_project_note');
  await expect(page.locator('#connection-result')).toContainText('ORBIT-42');
});
test('stdio inspection uses the local MCP process', async ({ page }) => {
  await page.goto('/');
  await page.locator('#transport').selectOption('stdio');
  await page.locator('#inspect').click();
  await expect(page.locator('#connection-status')).toHaveText('Connected');
  await expect(page.locator('#connection-summary')).toContainText('stdio: actual MCP');
});
test('recorded fixture is labeled and cannot be resumed as live work', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#messages')).toContainText('ORBIT-42');
  await expect(page.locator('#resume')).toBeDisabled();
  await expect(page.locator('#resume-note')).toContainText('recorded fixture');
  await expect(page.locator('#subagent-messages')).toContainText('Discovery alone does not create');
});
test('rename and tag update the selected session and library card', async ({ page }) => {
  await seed(page);
  await page.locator('#rename-title').fill('Student review');
  await page.locator('#rename').click();
  await expect(page.locator('#session-title')).toHaveText('Student review');
  await page.locator('#tag-value').fill('practice');
  await page.locator('#tag').click();
  await expect(page.locator('#session-tag')).toHaveText('practice');
  await expect(page.locator('.session-card[aria-pressed=true]')).toContainText('Student review');
});
test('fork preserves the original identity and conversation', async ({ page }) => {
  await seed(page);
  const source = await page.locator('#session-id').textContent();
  await page.locator('#fork-title').fill('Alternative branch');
  await page.locator('#fork').click();
  await expect(page.locator('#session-title')).toHaveText('Alternative branch');
  await expect(page.locator('#session-id')).not.toHaveText(source!);
  await expect(page.locator('#session-parent')).toContainText(source!.slice(0, 8));
  await expect(page.locator('#messages .history-message')).toHaveCount(2);
  await page.locator(`[data-session="${source}"]`).click();
  await expect(page.locator('#session-id')).toHaveText(source!);
  await expect(page.locator('#messages .history-message')).toHaveCount(2);
});
test('deletion shows a concrete confirmation and removes only the chosen branch', async ({
  page,
}) => {
  await seed(page);
  const source = await page.locator('#session-id').textContent();
  await page.locator('#fork-title').fill('Temporary branch');
  await page.locator('#fork').click();
  await expect(page.locator('#session-title')).toHaveText('Temporary branch');
  const branch = await page.locator('#session-id').textContent();
  await page.locator('#delete').click();
  await expect(page.locator('#delete-label')).toContainText(branch!);
  await expect(page.locator('#delete-confirm')).toContainText('private local copy remain');
  await page.locator('#confirm-delete').click();
  await expect(page.locator(`[data-session="${branch}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-session="${source}"]`)).toHaveCount(1);
});
test('session titles are rendered as text rather than HTML', async ({ page }) => {
  await seed(page);
  await page.locator('#rename-title').fill('<img src=x onerror=alert(1)>');
  await page.locator('#rename').click();
  await expect(page.locator('#session-title')).toContainText('<img');
  expect(await page.locator('#session-title img').count()).toBe(0);
  expect(await page.locator('.session-card img').count()).toBe(0);
});
test('concept guide and quiz separate discovery, execution and session branching', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Concept guide/ }).click();
  await expect(page.locator('.method-card')).toHaveCount(9);
  await expect(page.locator('#guide')).toContainText('SessionStore');
  await page.getByRole('tab', { name: /Knowledge check/ }).click();
  for (const [i, choice] of [0, 1, 2, 0].entries())
    await page.locator(`input[name=q${i}][value="${choice}"]`).check();
  await page.getByRole('button', { name: 'Check my answers' }).click();
  await expect(page.locator('#quiz-score')).toContainText('4 / 4 correct');
});
test('phone layout fits the transport cards, selected library and guide', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  for (const tab of [/Connection lab/, /Session library/, /Concept guide/, /Knowledge check/]) {
    await page.getByRole('tab', { name: tab }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
test('a selected-field live result is safely rendered and can open its saved session', async ({
  page,
}) => {
  const id = '11111111-1111-4111-8111-111111111111';
  await page.route('**/api/meta', (route) =>
    route.fulfill({ json: { version: '0.3.310', liveAvailable: true, model: 'test-model' } }),
  );
  await page.route('**/api/library', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/run', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: [
        {
          kind: 'result',
          title: 'Completed',
          detail: 'Test',
          data: {
            ok: true,
            sessionId: id,
            text: '<img src=x onerror=alert(1)>',
            transport: 'sdk',
            toolReads: 1,
            agentStarts: 0,
            agents: ['risk-reviewer'],
            connections: [{ name: 'project', status: 'connected' }],
            costUsd: 0.001,
          },
        },
        { kind: 'done', title: 'Finished', detail: 'success' },
      ]
        .map((e) => `data: ${JSON.stringify(e)}\n\n`)
        .join(''),
    }),
  );
  await page.goto('/');
  await page.locator('#new-session').click();
  await expect(page.locator('#status')).toHaveText('Completed');
  await expect(page.locator('#agent-starts')).toHaveText('0');
  await expect(page.locator('#agent-discovered')).toHaveText('1');
  await expect(page.locator('#result')).toContainText('<img');
  expect(await page.locator('#result img').count()).toBe(0);
  await expect(page.locator('#view-saved')).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  expect((await download).suggestedFilename()).toBe('lesson-06-workflow-trace.json');
});
