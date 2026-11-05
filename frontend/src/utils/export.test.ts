import { escapeCsvCell } from './export';


describe('escapeCsvCell', () => {
  it.each(['=2+2', '+SUM(A1:A2)', '-cmd', '@IMPORTXML(A1)', '\tformula'])(
    'neutralizes spreadsheet formula input %s',
    (value) => expect(escapeCsvCell(value)).toBe(`'${value}`),
  );

  it('preserves numeric negative values', () => {
    expect(escapeCsvCell(-12.5)).toBe('-12.5');
  });

  it.each(['-120.00', '+5', '-0.5', '-.5'])(
    'leaves the plain number string %s alone so it still sums in a spreadsheet',
    (value) => expect(escapeCsvCell(value)).toBe(value),
  );

  it.each(['-1+2', '-120.00 ', '+1e3', '-2,5'])(
    'still neutralizes %s, which is not a plain number',
    (value) => expect(escapeCsvCell(value)).toMatch(/^"?'/),
  );

  it('quotes commas and embedded quotes', () => {
    expect(escapeCsvCell('Coffee, "large"')).toBe('"Coffee, ""large"""');
  });
});
