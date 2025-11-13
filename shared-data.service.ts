import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

interface ExamDay {
  date: Date | null;
  am: boolean;
  pm: boolean;
}

interface ExamGroup {
  name: string;
  days: ExamDay[];
}

@Injectable({
  providedIn: 'root'
})
export class SharedDataService {
  private examDatesKey = 'examDates';
  private studentMappingKey = 'studentMapping';
  private roomMappingKey = 'roomAssignments';
  private selectedExamGroupKey = 'selectedExamGroup'; // NEW

  // Live data streams
  private examDatesSource = new BehaviorSubject<any[]>(this.loadFromStorage(this.examDatesKey) || []);
  examDates$ = this.examDatesSource.asObservable();

  // NEW: selected exam group
  private selectedExamGroupSource = new BehaviorSubject<ExamGroup | null>(
    this.loadFromStorage(this.selectedExamGroupKey)
  );
  selectedExamGroup$ = this.selectedExamGroupSource.asObservable();

  constructor() {}

  // Generic Local Storage Helper
  private loadFromStorage(key: string): any {
    const data = localStorage.getItem(key);
    try {
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  private saveToStorage(key: string, value: any) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // --------------------
  // 1️⃣ Exam Dates
  // --------------------
  setExamDates(dates: any[]) {
    this.saveToStorage(this.examDatesKey, dates);
    this.examDatesSource.next(dates);
  }

  getExamDates(): any[] {
    return this.loadFromStorage(this.examDatesKey) || [];
  }

  clearExamDates() {
    localStorage.removeItem(this.examDatesKey);
    this.examDatesSource.next([]);
  }

  // --------------------
  // 2️⃣ Student Mapping
  // --------------------
  setStudentMapping(data: any) {
    this.saveToStorage(this.studentMappingKey, data);
  }

  getStudentMapping() {
    return this.loadFromStorage(this.studentMappingKey);
  }

  clearStudentMapping() {
    localStorage.removeItem(this.studentMappingKey);
  }

  // --------------------
  // 3️⃣ Room Mapping
  // --------------------
  setRoomMapping(data: any) {
    this.saveToStorage(this.roomMappingKey, data);
  }

  getRoomMapping() {
    return this.loadFromStorage(this.roomMappingKey);
  }

  clearRoomMapping() {
    localStorage.removeItem(this.roomMappingKey);
  }

  // --------------------
  // 4️⃣ Selected Exam Group (NEW)
  // --------------------
  setSelectedExamGroup(group: ExamGroup) {
    this.saveToStorage(this.selectedExamGroupKey, group);
    this.selectedExamGroupSource.next(group);
  }

  getSelectedExamGroup(): ExamGroup | null {
    return this.loadFromStorage(this.selectedExamGroupKey) || this.selectedExamGroupSource.value;
  }

  clearSelectedExamGroup() {
    localStorage.removeItem(this.selectedExamGroupKey);
    this.selectedExamGroupSource.next(null);
  }
}
