describe.skip('disabled', () => {
  it('empty', () => {});
  describe('nested', () => it.skip('explicit', handler));
  it.skipIf(condition)('conditional', handler);
  it.todo('todo');
  test.skip(condition, 'disabled reason');
});
xdescribe('aliases', () => it('alias child', handler));
xit('pending');
describe('active', () => {
  it('active empty', () => {});
  it('active conditional', ctx => { ctx.skip('active reason'); expect(1).toBe(1); });
});
