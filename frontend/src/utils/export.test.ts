import { escapeCsvCell } from './export';


describe('escapeCsvCell', () => {
  it.each(['=2+2', '+SUM(A1:A2)', '-cmd', '@IMPORTXML(A1)', '\tformula'])(
    'neutralizes spreadsheet formula input %s',
    (value) => expect(escapeCsvCell(value)).toBe(`'${value}`),
  );

  it('preserves numeric negative values', () => {
    expect(escapeCsvCell(-12.5)).toBe('-12.5');
  });

  it('quotes commas and embedded quotes', () => {
    expect(escapeCsvCell('Coffee, "large"')).toBe('"Coffee, ""large"""');
  });
});
