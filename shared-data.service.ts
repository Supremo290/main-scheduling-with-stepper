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
  termYear?: string; // ✅ NEW: Store term/year with the group
}

interface StudentMappingData {
  examGroupName: string;
  termYear: string;
  scheduleData: any[];
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class SharedDataService {
  private examDatesKey = 'examDates';
  private studentMappingKey = 'studentMapping';
  private studentMappingByGroupKey = 'studentMappingByGroup'; // ✅ NEW: Store mappings per group
  private roomMappingKey = 'roomAssignments';
  private selectedExamGroupKey = 'selectedExamGroup';
  private activeTermKey = 'activeTerm'; // ✅ NEW: Store active term

  // Live data streams
  private examDatesSource = new BehaviorSubject<any[]>(this.loadFromStorage(this.examDatesKey) || []);
  examDates$ = this.examDatesSource.asObservable();

  private selectedExamGroupSource = new BehaviorSubject<ExamGroup | null>(
    this.loadFromStorage(this.selectedExamGroupKey)
  );
  selectedExamGroup$ = this.selectedExamGroupSource.asObservable();

  private activeTermSource = new BehaviorSubject<string | null>(
    this.loadFromStorage(this.activeTermKey)
  );
  activeTerm$ = this.activeTermSource.asObservable();

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
  // 2️⃣ Active Term (NEW)
  // --------------------
  setActiveTerm(term: string) {
    this.saveToStorage(this.activeTermKey, term);
    this.activeTermSource.next(term);
  }

  getActiveTerm(): string | null {
    return this.loadFromStorage(this.activeTermKey);
  }

  clearActiveTerm() {
    localStorage.removeItem(this.activeTermKey);
    this.activeTermSource.next(null);
  }

  // --------------------
  // 3️⃣ Student Mapping (Legacy - for backward compatibility)
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
  // 4️⃣ Student Mapping by Group (NEW - Better approach)
  // --------------------
  setStudentMappingForGroup(examGroupName: string, termYear: string, scheduleData: any[]) {
    const allMappings = this.loadFromStorage(this.studentMappingByGroupKey) || {};
    
    // Create a unique key combining group name and term
    const key = `${examGroupName}_${termYear}`;
    
    allMappings[key] = {
      examGroupName,
      termYear,
      scheduleData,
      timestamp: Date.now()
    };
    
    this.saveToStorage(this.studentMappingByGroupKey, allMappings);
    console.log(`✅ Saved student mapping for ${examGroupName} (${termYear})`);
  }

  getStudentMappingForGroup(examGroupName: string, termYear: string): any[] | null {
    const allMappings = this.loadFromStorage(this.studentMappingByGroupKey) || {};
    const key = `${examGroupName}_${termYear}`;
    
    const mapping = allMappings[key];
    if (mapping) {
      console.log(`📖 Loaded student mapping for ${examGroupName} (${termYear})`);
      return mapping.scheduleData;
    }
    
    console.log(`⚠️ No saved mapping found for ${examGroupName} (${termYear})`);
    return null;
  }

  clearStudentMappingForGroup(examGroupName: string, termYear: string) {
    const allMappings = this.loadFromStorage(this.studentMappingByGroupKey) || {};
    const key = `${examGroupName}_${termYear}`;
    delete allMappings[key];
    this.saveToStorage(this.studentMappingByGroupKey, allMappings);
  }

  // --------------------
  // 5️⃣ Room Mapping
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
  // 6️⃣ Selected Exam Group
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

  // --------------------
  // 7️⃣ Clear All Data
  // --------------------
  clearAllSchedulingData() {
    this.clearExamDates();
    this.clearStudentMapping();
    this.clearRoomMapping();
    this.clearSelectedExamGroup();
    this.clearActiveTerm();
    console.log("🗑️ All scheduling data cleared!");
  }

  // --------------------
  // 8️⃣ Utility: Get all saved mappings (for debugging)
  // --------------------
  getAllSavedMappings(): any {
    return this.loadFromStorage(this.studentMappingByGroupKey) || {};
  }
}