import { Injectable } from "@angular/core";
import { Http, Headers, RequestOptions } from "@angular/http";
//import { Observable } from 'rxjs';
import { GlobalService } from "./global.service";
import { HttpParams } from "@angular/common/http";

@Injectable({
  providedIn: "root",
})
export class ApiService {
  constructor(private http: Http, public global: GlobalService) {}

  getPublicAPICurrentServerTime() {
    return this.http.get(
      this.global.api + "PublicAPI/CurrentServerTime",
      this.global.option
    );
  }

  getAuthUserRoles() {
    return this.http.get(
      this.global.api + "Auth/UserRoles",
      this.global.option
    );
  }


  getProvinces() {
    return this.http.get(
      this.global.api + "PublicAPI/Provinces",
      this.global.option
    );
  }

  getTownsCities(province) {
    return this.http.get(
      this.global.api + "PublicAPI/TownsCities/" + province,
      this.global.option
    );
  }

   getBarangays(province,townsCity) {
    return this.http.get(
      this.global.api + "PublicAPI/Barangays/" + province + "/" + townsCity,
      this.global.option
    );
  }



  getPublicAPIDepartments() {
    return this.http.get(
      this.global.api + "PublicAPI/Departments",
      this.global.option
    );
  }

  getPublicAPIProgramLevels() {
    return this.http.get(
      this.global.api + "PublicAPI/ProgramLevels",
      this.global.option
    );
  }

  getAuthUserViewDomains() {
    return this.http.get(
      this.global.api + "Auth/UserViewDomains",
      this.global.option
    );
  }

  getPublicAPISYOptionsList() {
    return this.http.get(
      this.global.api + "PublicAPI/SYOptionsList",
      this.global.option
    );
  }

  getAuthUserInfo() {
    return this.http.get(this.global.api + "Auth/UserInfo", this.global.option);
  }

  putAccountChangePassword(data) {
    return this.http.put(
      this.global.api + "Account/ChangePassword",
      data,
      this.global.option
    );
  }

  postAuthlogin(data, option) {
    return this.http.post(this.global.api + "Auth/login", data, option);
  }

  getAccess(x = null) {
    if (x == null) x = this.global.requestid();

    return this.http.get(this.global.api + "Access/" + x, this.global.option);
  }

  getCodeLookUpSubjectsfind(text) {
    return this.http.get(
      this.global.api + "Tools/CodeLookup/" + text,
      this.global.option
    );
  }

  getPersonFinder(lname, bool) {
    return this.http.get(
      this.global.api + "Tools/PersonFinder/" + lname + "/" + bool,
      this.global.option
    );
  }

  getPersonIDPicture(id) {
    return this.http.get(
      this.global.api + "Tools/IDInfo/" + id,
      this.global.option
    );
  }

  getCodeSummaryReport(schoolYear) {
    return this.http.get(
      this.global.api + "ReportSummary/CodeSummary/" + schoolYear,
      this.global.option
    );
  }

  getExaminationSchedule(
    schoolYear: string,
    examTermID?: number,
    codeNo?: string,
    proctorID?: string
  ) {
    let url = this.global.api + "ExaminationSchedule/?schoolYear=" + schoolYear;

    if (examTermID !== undefined && examTermID !== null) {
      url += "&examTermID=" + examTermID;
    }
    if (codeNo) {
      url += "&codeNo=" + encodeURIComponent(codeNo);
    }
    if (proctorID) {
      url += "&proctorID=" + encodeURIComponent(proctorID);
    }

    return this.http.get(url, this.global.option);
  }

  postExaminationSchedule(data) {
    return this.http.post(
      this.global.api + "ExaminationSchedule",
      data,
      this.global.option
    );
  }

  putExaminationSchedule(data) {
    return this.http.post(
      this.global.api + "ExaminationSchedule",
      data,
      this.global.option
    );
  }

  deleteExaminationScheduleIndividual() {
    return this.http.delete(
      this.global.api + "ExaminationSchedule/Individual",
      this.global.option
    );
  }

  deleteExaminationScheduleAll() {
    return this.http.delete(
      this.global.api + "ExaminationSchedule/All",
      this.global.option
    );
  }
}
