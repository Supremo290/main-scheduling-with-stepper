import { Component, Inject, OnInit, Optional } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { SharedDataService } from '../shared-data.service';

interface ExamDay {
  date: Date | null;
  am: boolean;
  pm: boolean;
}

interface ExamGroup {
  name: string;
  days: ExamDay[];
}

@Component({
  selector: 'app-date-picker',
  templateUrl: './date-picker.component.html',
  styleUrls: ['./date-picker.component.scss']
})
export class DatePickerComponent implements OnInit {
  examDays: ExamDay[] = [];
  savedExamGroups: ExamGroup[] = [];
  selectedGroupName: string | null = null;
  newGroupName: string = '';

  maxDays = 5;
  minDate!: Date;
  maxDate!: Date;

  constructor(
    private sharedData: SharedDataService,
    @Optional() public dialogRef?: MatDialogRef<DatePickerComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public data?: any
  ) {}

  ngOnInit() {
    const currentYear = new Date().getFullYear();
    this.minDate = new Date(currentYear, 0, 1);
    this.maxDate = new Date(2035, 11, 31);

    this.loadStoredGroups();
    this.resetExamDays();
  }

  /** Load all saved exam groups */
  loadStoredGroups() {
    const stored = localStorage.getItem('examGroups');
    this.savedExamGroups = stored ? JSON.parse(stored) : [];
  }

  /** Save all groups back to localStorage */
  saveAllGroups() {
    localStorage.setItem('examGroups', JSON.stringify(this.savedExamGroups));
  }

  /** Add new date entry */
  addDay() {
    if (this.examDays.length < this.maxDays) {
      this.examDays.push({ date: null, am: false, pm: false });
    }
  }

  /** Remove a date entry */
  removeDay(index: number) {
    this.examDays.splice(index, 1);
  }

  /** Reset the picker input */
  resetExamDays() {
    this.examDays = [{ date: null, am: false, pm: false }];
  }

  /** Save new group of exam dates */
  saveGroup() {
    const validDays = this.examDays.filter(d => d.date instanceof Date);
    if (!validDays.length) {
      alert('Please select at least one valid exam date.');
      return;
    }
    if (!this.newGroupName.trim()) {
      alert('Please enter a name for this exam schedule.');
      return;
    }

    const newGroup: ExamGroup = {
      name: this.newGroupName.trim(),
      days: validDays
    };

    // Check if name already exists
    const existingIndex = this.savedExamGroups.findIndex(g => g.name === newGroup.name);
    if (existingIndex !== -1) {
      if (confirm(`"${newGroup.name}" already exists. Replace it?`)) {
        this.savedExamGroups[existingIndex] = newGroup;
      } else {
        return;
      }
    } else {
      this.savedExamGroups.push(newGroup);
    }

    this.saveAllGroups();
    this.loadStoredGroups();
    this.resetExamDays();
    this.newGroupName = '';

    alert('✅ Exam group saved!');
  }

  /** Delete a saved group */
  deleteGroup(groupName: string) {
    if (confirm(`Delete exam group "${groupName}"?`)) {
      this.savedExamGroups = this.savedExamGroups.filter(g => g.name !== groupName);
      this.saveAllGroups();
      this.loadStoredGroups();
    }
  }

  /** Select a group to use for next stepper */
  selectGroup(group: ExamGroup) {
    this.selectedGroupName = group.name;
    this.sharedData.setExamDates(group.days);
    this.sharedData.setSelectedExamGroup(group);
    alert(`✅ Selected "${group.name}" for scheduling.`);
  }

  /** Disable already selected dates in current input */
  dateFilter = (date: Date | null): boolean => {
    if (!date) return true;
    const selectedDates = this.examDays
      .map(d => d.date instanceof Date ? d.date.toDateString() : null)
      .filter(d => d !== null);
    return !selectedDates.includes(date.toDateString());
  };
}
