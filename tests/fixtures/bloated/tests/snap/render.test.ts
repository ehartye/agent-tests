import { describe, expect, it } from 'vitest';
import { render } from '../../src/util/render.ts';

describe('render', () => {
  it('renders the name', () => {
    expect(render('x')).toMatchSnapshot();
  });
});
