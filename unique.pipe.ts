import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'unique'
})
export class UniquePipe implements PipeTransform {
  transform(items: any[], field: string): any[] {
    if (!items || !field) {
      return items;
    }

    const uniqueValues = new Set();
    return items.filter(item => {
      const value = item[field];
      if (uniqueValues.has(value)) {
        return false;
      }
      uniqueValues.add(value);
      return true;
    });
  }
}